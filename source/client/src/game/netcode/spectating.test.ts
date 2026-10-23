import { expect, test, vi } from "vitest";
import mapData from "../../../../common/maps/main-babe.json";
import { GameSocket, type RoomState } from "../../network/GameSocket";
import { GameSimulation } from "../simulation/GameSimulation";
import { parseMap } from "../simulation/map";
import { OnlineRuntime, type OnlineSnapshot } from "./OnlineRuntime";

const map = parseMap(mapData);
const room: RoomState = {
	roomId: "ABCDEF",
	kind: "ROOM",
	state: "PLAYING",
	hostPlayerId: "self",
	settings: {
		mapLevel: 10,
		mode: "RACE",
		timeLimitMinutes: null,
		itemsEnabled: false,
		itemCooldownMinutes: 3,
	},
	members: [],
	currentPlay: null,
	result: null,
};
test("watching changes the rendered player and scene without restoring target state into prediction", () => {
	const socket = new GameSocket(
		() => {},
		() => {},
	);
	socket.selfId = "self";
	socket.playContext = { playId: "match", generation: 1 };
	const send = vi.spyOn(socket, "input");
	const runtime = new OnlineRuntime(
		map,
		socket,
		room,
		() => ({ left: false, right: true, jump: true }),
		() => {},
		false,
	);
	const own = new GameSimulation(map).snapshot();
	const target = { ...own.physics, x: 80, y: -1800, screen: 5, ticks: 100 };
	const view = {
		player: {
			playerId: "peer",
			nickname: "Peer",
			colorSlot: 1,
			state: target,
			crowned: true,
			status: "ACTIVE",
		},
		playId: "match",
		elapsedTimeMs: 1000,
		paused: false,
		adventure: own.adventure,
		world: own.world,
	};
	const snapshot: OnlineSnapshot = {
		roomId: room.roomId,
		playId: "match",
		generation: 1,
		serverTick: 100,
		elapsedTimeMs: 1000,
		remainingTimeMs: null,
		self: {
			lastProcessedInputSeq: 0,
			status: "ACTIVE",
			paused: false,
			metrics: {},
			simulation: own,
		},
		spectating: view,
		peers: [view.player],
	};
	runtime.receive(snapshot as unknown as Record<string, unknown>);
	runtime.advance(100);
	expect(send).not.toHaveBeenCalled();
	expect(runtime.game.snapshot()).toEqual(own);
	expect(runtime.frame().self).toMatchObject({
		id: "peer",
		nickname: "Peer",
		crowned: true,
		state: target,
	});
	expect(runtime.frame().peers.map((p) => p.id)).toEqual(["self"]);
	const next = {
		...view,
		player: { ...view.player, state: { ...target, screen: 6, y: -2160 } },
	};
	runtime.receive({
		...snapshot,
		serverTick: 101,
		spectating: next,
		peers: [next.player],
	} as unknown as Record<string, unknown>);
	expect(runtime.frame().self.state.screen).toBe(6);
	expect(runtime.game.snapshot()).toEqual(own);
	runtime.receive({
		...snapshot,
		serverTick: 102,
		spectating: null,
		peers: [],
	} as unknown as Record<string, unknown>);
	expect(runtime.frame().self.id).toBe("self");
	expect(runtime.frame().self.state).toEqual(own.physics);
	runtime.advance(1000 / 60);
	expect(send).toHaveBeenCalledWith(
		"PLAYER_INPUT",
		expect.objectContaining({ playId: "match", generation: 1, seq: 1 }),
	);
});

test("returning discards cancelled frames from watching before reconciling the viewer", () => {
	const socket = new GameSocket(
		() => {},
		() => {},
	);
	socket.selfId = "self";
	socket.playContext = { playId: "match", generation: 1 };
	vi.spyOn(socket, "input");
	const runtime = new OnlineRuntime(
		map,
		socket,
		room,
		() => ({ left: false, right: true, jump: false }),
		() => {},
		false,
	);
	const own = new GameSimulation(map).snapshot();
	const state: OnlineSnapshot = {
		roomId: room.roomId,
		playId: "match",
		generation: 1,
		serverTick: 1,
		elapsedTimeMs: 0,
		remainingTimeMs: null,
		self: {
			lastProcessedInputSeq: 0,
			status: "ACTIVE",
			paused: false,
			metrics: {},
			simulation: own,
		},
		spectating: {
			player: {
				playerId: "peer",
				nickname: "Peer",
				colorSlot: 1,
				state: { ...own.physics, screen: 6, y: -2160 },
				crowned: false,
				status: "ACTIVE",
			},
			playId: "match",
			elapsedTimeMs: 0,
			paused: false,
			adventure: own.adventure,
			world: own.world,
		},
		peers: [],
	};
	runtime.receive(state as unknown as Record<string, unknown>);
	runtime.cancel();
	runtime.receive({
		...state,
		serverTick: 2,
		spectating: null,
	} as unknown as Record<string, unknown>);
	expect(runtime.game.snapshot()).toEqual(own);
	expect(runtime.frame().self.id).toBe("self");
});
