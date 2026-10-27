import { expect, test, vi } from "vitest";
import easyFixture from "../../../../common/fixtures/easy-respawn.json";
import mapData from "../../../../common/maps/main-babe.json";
import { NETWORK } from "../../network/config";
import { GameSocket, type RoomState } from "../../network/GameSocket";
import { required } from "../../required";
import { GameSimulation } from "../simulation/GameSimulation";
import { parseMap } from "../simulation/map";
import { OnlineRuntime, type OnlineSnapshot } from "./OnlineRuntime";
import { PeerInterpolation } from "./PeerInterpolation";
import { Prediction } from "./Prediction";

const map = parseMap(mapData),
	right = { left: false, right: true, jump: false };
const room: RoomState = {
	roomId: "ABCDEF",
	kind: "COMMUNITY",
	state: "PLAYING",
	hostPlayerId: null,
	settings: null,
	currentPlay: null,
	result: null,
	members: [
		{
			playerId: "self",
			nickname: "Player",
			colorSlot: 0,
			connected: true,
			paused: false,
			nextMatchConfirmed: null,
		},
	],
};
function snapshot(
	game: GameSimulation,
	tick: number,
	ack: number,
	generation = 1,
): OnlineSnapshot {
	return {
		roomId: room.roomId,
		serverTick: tick,
		playId: "run",
		generation,
		elapsedTimeMs: 0,
		remainingTimeMs: null,
		self: {
			crown: "NONE" as const,
			lastProcessedInputSeq: ack,
			status: "ACTIVE",
			paused: false,
			simulation: game.snapshot(),
		},
		peers: [],
	};
}
function fallingPeerSnapshot(
	game: GameSimulation,
	tick: number,
	y: number,
	positionRevision = 0,
): OnlineSnapshot {
	const value = snapshot(game, tick, 0);
	value.peers = [
		{
			playerId: "peer",
			positionRevision,
			nickname: "Peer",
			colorSlot: 1,
			crown: "NONE",
			status: "ACTIVE",
			state: {
				...game.physics.snapshot(),
				x: 100,
				y,
				vy: 10,
				grounded: false,
				screen: 1,
				ticks: tick,
			},
		},
	];
	return value;
}
test("missing acknowledgements stops input and requests disconnect; a new generation resumes cleanly", () => {
	const socket = new GameSocket(
		() => {},
		() => {},
	);
	const fail = vi.spyOn(socket, "fail"),
		send = vi.spyOn(socket, "input");
	const failed = vi.fn();
	socket.selfId = "self";
	socket.playContext = { playId: "run", generation: 1 };
	const game = new GameSimulation(map);
	const runtime = new OnlineRuntime(
		map,
		socket,
		room,
		() => right,
		() => {},
		false,
		failed,
	);
	runtime.receive(snapshot(game, 1, 0) as unknown as Record<string, unknown>);
	for (let index = 0; index <= NETWORK.maxInputFrames; index++)
		runtime.advance(1000 / 60);
	expect(runtime.menu).toBe(true);
	expect(fail).toHaveBeenCalledExactlyOnceWith(
		expect.stringContaining("too far behind"),
	);
	expect(failed).toHaveBeenCalledOnce();
	const sent = send.mock.calls.length;
	runtime.advance(100);
	expect(send).toHaveBeenCalledTimes(sent);
	socket.playContext = { playId: "run", generation: 2 };
	runtime.receive(
		snapshot(game, 2, 0, 2) as unknown as Record<string, unknown>,
	);
	runtime.menu = false;
	runtime.advance(1000 / 60);
	expect(send).toHaveBeenLastCalledWith(
		"PLAYER_INPUT",
		expect.objectContaining({ generation: 2, seq: 1 }),
	);
});
test("online ending waits for the private committed notice and matching finished snapshot", () => {
	const socket = new GameSocket(
		() => {},
		() => {},
	);
	socket.selfId = "self";
	socket.playContext = { playId: "run", generation: 1 };
	const game = new GameSimulation(map),
		runtime = new OnlineRuntime(
			map,
			socket,
			room,
			() => right,
			() => {},
			false,
		);
	const notice = {
		playerId: "self",
		playId: "run",
		showEnding: true,
		ending: { screen: 42, ravenDone: true, crown: "BLACK" },
	};
	runtime.receive(snapshot(game, 1, 0) as unknown as Record<string, unknown>);
	runtime.finish({ ...notice, playerId: "other" });
	expect(runtime.frame().ending).toBeUndefined();
	runtime.finish(notice);
	expect(runtime.frame().ending).toBeUndefined();
	const finished = snapshot(game, 2, 0);
	finished.self.status = "FINISHED";
	finished.self.paused = true;
	runtime.receive(finished as unknown as Record<string, unknown>);
	expect(runtime.frame().ending).toEqual({
		id: "run",
		screen: 42,
		ravenDone: true,
		crown: "BLACK",
	});
	runtime.finish(notice);
	expect(runtime.frame().ending).toEqual({
		id: "run",
		screen: 42,
		ravenDone: true,
		crown: "BLACK",
	});
	socket.playContext = { playId: "next", generation: 2 };
	runtime.receive({
		...snapshot(game, 3, 0, 2),
		playId: "next",
	} as unknown as Record<string, unknown>);
	expect(runtime.frame().ending).toBeUndefined();
	runtime.finish(notice);
	expect(runtime.frame().ending).toBeUndefined();
});
test("flight intent survives an older ACK and resets for a new run while the gate stays authoritative", () => {
	const socket = new GameSocket(
		() => {},
		() => {},
	);
	socket.selfId = "self";
	socket.input = vi.fn();
	const game = new GameSimulation(map, true),
		runtime = new OnlineRuntime(
			map,
			socket,
			room,
			() => ({ ...right, up: true }),
			() => {},
			true,
		);
	runtime.receive(snapshot(game, 1, 0) as unknown as Record<string, unknown>);
	runtime.setFlight(true);
	runtime.advance(17);
	expect(socket.input).toHaveBeenLastCalledWith(
		"PLAYER_INPUT",
		expect.objectContaining({ freeFlight: true, up: true }),
	);
	runtime.receive(snapshot(game, 2, 0) as unknown as Record<string, unknown>);
	runtime.advance(17);
	expect(socket.input).toHaveBeenLastCalledWith(
		"PLAYER_INPUT",
		expect.objectContaining({ freeFlight: true }),
	);
	runtime.setFlight(false);
	runtime.advance(17);
	expect(socket.input).toHaveBeenLastCalledWith(
		"PLAYER_INPUT",
		expect.objectContaining({ freeFlight: false }),
	);
	runtime.setFlight(true);
	runtime.receive({
		...snapshot(game, 3, 0, 2),
		playId: "next",
	} as unknown as Record<string, unknown>);
	expect(runtime.flying).toBe(false);
	const forbidden = new OnlineRuntime(
		map,
		socket,
		room,
		() => right,
		() => {},
		false,
	);
	forbidden.setFlight(true);
	expect(forbidden.flying).toBe(false);
});
test("prediction responds before an ACK and replays only unacknowledged input after correction", () => {
	const local = new GameSimulation(map),
		server = new GameSimulation(map),
		prediction = new Prediction(local, 180);
	for (let seq = 1; seq <= 20; seq++) {
		prediction.push(seq, right);
		if (seq <= 7) server.tick(right);
	}
	const before = local.snapshot();
	expect(before.physics.x).toBeGreaterThan(map.spawn.x);
	prediction.reconcile(server.snapshot(), 7, true);
	expect(prediction.pending).toBe(13);
	expect(local.snapshot()).toEqual(before);
	prediction.reconcile(before, 20, true);
	expect(prediction.pending).toBe(0);
	expect(local.snapshot()).toEqual(before);
});
test("Boots are consumed once when unacknowledged jump inputs replay", () => {
	const local = new GameSimulation(map),
		server = new GameSimulation(map);
	for (let tick = 0; tick < 30; tick++) server.tick(right);
	server.physics.boostJump();
	local.restore(server.snapshot());
	const prediction = new Prediction(local, 180);
	for (let seq = 1; seq <= 36; seq++) {
		const input = { ...right, jump: true };
		prediction.push(seq, input);
		if (seq <= 10) server.tick(input);
	}
	const expected = local.snapshot();
	expect(expected.physics.jumpBoost).toBeUndefined();
	expect(expected.physics.jumps).toBe(1);
	expect(server.physics.snapshot().jumpBoost).toBe(true);
	prediction.reconcile(server.snapshot(), 10, true);
	expect(local.snapshot()).toEqual(expected);
	expect(prediction.pending).toBe(26);
});

test("Hardcore prediction and replay respawn on splat while preserving clock and counters", () => {
	const local = new GameSimulation(map),
		server = new GameSimulation(map),
		race = new GameSimulation(map);
	for (const game of [local, server, race])
		game.physics.restore({
			...game.physics.snapshot(),
			y: 280,
			vy: 10,
			grounded: false,
			ticks: 500,
			jumps: 12,
			falls: 2,
		});
	const prediction = new Prediction(local, 180, "HARDCORE"),
		neutral = { left: false, right: false, jump: false };
	for (let seq = 1; seq <= 6; seq++) {
		prediction.push(seq, neutral);
		if (seq <= 3) server.tick(neutral, "HARDCORE");
		race.tick(neutral);
	}
	expect(local.physics.snapshot()).toMatchObject({
		x: map.spawn.x,
		y: map.spawn.y,
		ticks: 506,
		jumps: 12,
		falls: 3,
		splat: 0,
	});
	const expected = local.snapshot();
	prediction.reconcile(server.snapshot(), 3, true);
	expect(local.snapshot()).toEqual(expected);
	expect(race.physics.snapshot().splat).toBeGreaterThan(0);
});
test("Easy reconciliation replays a SPLAT using the authoritative safe position", () => {
	const local = new GameSimulation(map),
		server = new GameSimulation(map),
		neutral = { left: false, right: false, jump: false };
	for (const game of [local, server]) {
		game.physics.restore({
			...game.physics.snapshot(),
			...easyFixture.safe,
			vy: 1,
			ticks: easyFixture.initialTicks,
			jumps: easyFixture.jumps,
			falls: easyFixture.falls,
		});
		game.tick(neutral, "EASY");
		game.physics.restore({
			...game.physics.snapshot(),
			...easyFixture.fall,
			grounded: false,
		});
	}
	const prediction = new Prediction(local, 180, "EASY");
	for (let seq = 1; seq <= 6; seq++) {
		prediction.push(seq, neutral);
		if (seq <= 3) server.tick(neutral, "EASY");
	}
	const expected = local.snapshot();
	expect(server.physics.snapshot()).toMatchObject(easyFixture.expected);
	prediction.reconcile(server.snapshot(), 3, true);
	expect(prediction.pending).toBe(3);
	expect(local.snapshot()).toEqual(expected);
	expect(local.snapshot().world.safePosition).toEqual(easyFixture.safe);
});

test("input overflow is explicit, and cancel drops pending jump edges without launching", () => {
	const game = new GameSimulation(map),
		prediction = new Prediction(game, 2);
	prediction.push(1, { ...right, jump: true });
	prediction.push(2, { ...right, jump: true });
	const before = game.snapshot();
	expect(() => prediction.push(3, right)).toThrow("acknowledgements");
	expect(game.snapshot()).toEqual(before);
	prediction.cancel(3);
	expect(prediction.pending).toBe(1);
	expect(game.physics.snapshot().charge).toBe(0);
	expect(game.physics.snapshot().jumps).toBe(0);
	const authoritative = new GameSimulation(map);
	authoritative.physics.cancelInput();
	authoritative.tick({ left: false, right: false, jump: false });
	prediction.reconcile(authoritative.snapshot(), 3, true);
	expect(prediction.pending).toBe(0);
	expect(game.physics.snapshot().jumps).toBe(0);
});
test("paused reconciliation restores authority without replay and rejects malformed ACK", () => {
	const game = new GameSimulation(map),
		server = new GameSimulation(map),
		prediction = new Prediction(game, 180);
	prediction.push(1, right);
	prediction.push(2, right);
	prediction.reconcile(server.snapshot(), 0, false);
	expect(game.snapshot()).toEqual(server.snapshot());
	expect(prediction.pending).toBe(2);
	expect(() => prediction.reconcile(server.snapshot(), 1.5, true)).toThrow(
		"acknowledgement",
	);
	prediction.reset();
	expect(prediction.pending).toBe(0);
});
test("server Pause discards inputs canceled by the actor so Resume cannot replay an old charge", () => {
	const socket = new GameSocket(
		() => {},
		() => {},
	);
	socket.selfId = "self";
	socket.input = vi.fn();
	const server = new GameSimulation(map),
		runtime = new OnlineRuntime(
			map,
			socket,
			room,
			() => ({ ...right, jump: true }),
			() => {},
			false,
		);
	runtime.receive(snapshot(server, 1, 0) as unknown as Record<string, unknown>);
	runtime.advance(51);
	expect(runtime.game.physics.snapshot().charge).toBeGreaterThan(0);
	const paused = snapshot(server, 2, 0);
	paused.self.paused = true;
	runtime.receive(paused as unknown as Record<string, unknown>);
	runtime.receive(snapshot(server, 3, 0) as unknown as Record<string, unknown>);
	expect(runtime.game.snapshot()).toEqual(server.snapshot());
});
test("remote interpolation follows server tick spacing and never extrapolates or resurrects removed peers", () => {
	const game = new GameSimulation(map),
		previous = snapshot(game, 3, 0),
		current = snapshot(game, 6, 0);
	const peer = {
		playerId: "other",
		positionRevision: 0,
		nickname: "Other",
		colorSlot: 1,
		state: game.physics.snapshot(),
		crown: "NONE" as const,
		status: "ACTIVE",
	};
	previous.peers = [{ ...peer, state: { ...peer.state, x: 100, ticks: 3 } }];
	current.peers = [{ ...peer, state: { ...peer.state, x: 120, ticks: 6 } }];
	const interpolation = new PeerInterpolation(60);
	interpolation.receive(previous, 0);
	interpolation.receive(current, 50);
	expect(
		required(interpolation.frame(NETWORK.interpolationDelayMs + 25)[0]).state.x,
	).toBe(110);
	expect(
		required(interpolation.frame(NETWORK.interpolationDelayMs + 100)[0]).state
			.x,
	).toBe(120);
	interpolation.receive({ ...current, serverTick: 9, peers: [] }, 200);
	expect(interpolation.frame(220)).toEqual([]);
});

test("buffered peers move continuously through delayed and bunched snapshots", () => {
	const game = new GameSimulation(map),
		interpolation = new PeerInterpolation(60),
		delay = NETWORK.interpolationDelayMs;
	// Giữ chuỗi đến dồn trong bộ đệm hiện tại, không giả định độ trễ 100 ms.
	const arrivals = new Map([
		[0, 0],
		[50, 1],
		[delay + 20, 2],
		[delay + 40, 3],
		[delay + 110, 4],
		[delay + 150, 5],
	]);
	let previousX = 0;
	for (let now = 0; now <= delay + 150; now++) {
		const index = arrivals.get(now);
		if (index !== undefined) {
			const packet = snapshot(game, index * 3, 0);
			packet.peers = [
				{
					playerId: "peer",
					positionRevision: 0,
					nickname: "Peer",
					colorSlot: 1,
					crown: "NONE" as const,
					status: "ACTIVE",
					state: {
						...game.physics.snapshot(),
						x: index * 10,
						ticks: index * 3,
					},
				},
			];
			interpolation.receive(packet, now);
		}
		const x = required(interpolation.frame(now)[0]).state.x;
		if (now > delay + 10) {
			expect(x - previousX).toBeGreaterThan(0);
			expect(x - previousX).toBeLessThanOrEqual(0.221);
		}
		previousX = x;
	}
});

test("continuous falling interpolates snapshot gaps exceeding 96 pixels in the same screen", () => {
	const game = new GameSimulation(map),
		interpolation = new PeerInterpolation(60);
	interpolation.receive(fallingPeerSnapshot(game, 0, -300), 0);
	interpolation.frame(0);
	interpolation.receive(fallingPeerSnapshot(game, 12, -180), 200);
	expect(
		required(interpolation.frame(NETWORK.interpolationDelayMs + 150)[0]).state
			.y,
	).toBeCloseTo(-210);
	expect(
		required(interpolation.frame(NETWORK.interpolationDelayMs + 300)[0]).state
			.y,
	).toBe(-180);
});

test("bunched falling snapshots do not teleport toward a newest position over 96 pixels ahead", () => {
	const game = new GameSimulation(map),
		interpolation = new PeerInterpolation(60);
	interpolation.receive(fallingPeerSnapshot(game, 0, -300), 0);
	interpolation.frame(0);
	interpolation.frame(249);
	for (let tick = 3; tick <= 15; tick += 3)
		interpolation.receive(
			fallingPeerSnapshot(game, tick, -300 + tick * 10),
			250,
		);
	let previousY = -300;
	for (let now = 250; now <= 400; now++) {
		const y = required(interpolation.frame(now)[0]).state.y;
		expect(y - previousY).toBeGreaterThan(0);
		expect(y - previousY).toBeLessThanOrEqual(0.661);
		previousY = y;
	}
	expect(previousY).toBeLessThan(-150);
});

test("a same-screen respawn under 96 pixels snaps with unchanged falls without advancing other peers", () => {
	const game = new GameSimulation(map),
		interpolation = new PeerInterpolation(60);
	const previous = fallingPeerSnapshot(game, 0, -300),
		respawn = fallingPeerSnapshot(game, 3, -340, 1);
	for (const value of [previous, respawn]) {
		const peer = required(value.peers[0]);
		value.peers.push({
			...peer,
			playerId: "steady",
			positionRevision: 0,
			state: {
				...peer.state,
				x: value.serverTick * 1.5,
				y: -300,
				vy: 0,
				grounded: true,
			},
		});
	}
	interpolation.receive(previous, 0);
	interpolation.frame(0);
	interpolation.receive(respawn, 50);
	const frame = interpolation.frame(50);
	expect(required(frame[0])).toEqual(required(respawn.peers[0]));
	expect(required(frame[1]).state.x).toBe(0);
	expect(
		required(interpolation.frame(NETWORK.interpolationDelayMs + 25)[1]).state.x,
	).toBeCloseTo(2.25);
	expect(required(respawn.peers[0]).state.falls).toBe(0);
});

test("a peer returning after removal starts at its new position instead of stale buffered history", () => {
	const game = new GameSimulation(map),
		interpolation = new PeerInterpolation(60);
	interpolation.receive(fallingPeerSnapshot(game, 0, -300), 0);
	interpolation.frame(0);
	interpolation.receive(fallingPeerSnapshot(game, 3, -270), 50);
	interpolation.frame(50);
	interpolation.receive(snapshot(game, 6, 0), 60);
	expect(interpolation.frame(60)).toEqual([]);
	interpolation.receive(fallingPeerSnapshot(game, 9, -180), 70);
	expect(required(interpolation.frame(70)[0]).state.y).toBe(-180);
	interpolation.receive(fallingPeerSnapshot(game, 12, -150), 80);
	expect(required(interpolation.frame(80)[0]).state.y).toBe(-180);
	expect(required(interpolation.frame(350)[0]).state.y).toBe(-150);
});

test("snapshots after a respawn never pull a peer back into its buffered pre-respawn path", () => {
	const game = new GameSimulation(map),
		interpolation = new PeerInterpolation(60);
	interpolation.receive(fallingPeerSnapshot(game, 0, -300), 0);
	interpolation.frame(0);
	interpolation.receive(fallingPeerSnapshot(game, 3, -290), 50);
	interpolation.frame(50);
	interpolation.receive(fallingPeerSnapshot(game, 6, -250, 1), 100);
	expect(required(interpolation.frame(100)[0]).state.y).toBe(-250);
	interpolation.receive(fallingPeerSnapshot(game, 9, -240, 1), 110);
	interpolation.frame(110);
	interpolation.receive(fallingPeerSnapshot(game, 12, -230, 1), 120);
	let previousY = required(interpolation.frame(120)[0]).state.y;
	for (let now = 121; now <= 350; now++) {
		const y = required(interpolation.frame(now)[0]).state.y;
		expect(y).toBeGreaterThanOrEqual(previousY);
		expect(y).toBeLessThanOrEqual(-230);
		previousY = y;
	}
});

test("interpolation snaps screen changes and respawns and resets after a long silence", () => {
	const game = new GameSimulation(map),
		interpolation = new PeerInterpolation(60);
	const packet = (
		tick: number,
		x: number,
		screen = 0,
		positionRevision = 0,
	) => ({
		...snapshot(game, tick, 0),
		peers: [
			{
				playerId: "peer",
				positionRevision,
				nickname: "Peer",
				colorSlot: 1,
				crown: "NONE" as const,
				status: "ACTIVE",
				state: { ...game.physics.snapshot(), x, screen, ticks: tick },
			},
		],
	});
	interpolation.receive(packet(0, 100), 0);
	interpolation.frame(0);
	interpolation.receive(packet(3, 110), 50);
	interpolation.frame(50);
	interpolation.receive(packet(6, 300, 0, 1), 100);
	expect(required(interpolation.frame(100)[0]).state.x).toBe(300);
	interpolation.receive(packet(9, 10, 1, 1), 150);
	expect(required(interpolation.frame(150)[0]).state.screen).toBe(1);
	interpolation.receive(packet(8, 400, 1, 1), 160);
	expect(required(interpolation.frame(160)[0]).state.screen).toBe(1);
	interpolation.receive(packet(12, 200, 0, 1), 5000);
	expect(required(interpolation.frame(5000)[0]).state.x).toBe(200);
	interpolation.reset();
	expect(interpolation.frame(6000)).toEqual([]);
	interpolation.receive(packet(0, 40), 0);
	interpolation.frame(0);
	const respawn = packet(3, 30);
	required(respawn.peers[0]).state.falls = 1;
	interpolation.receive(respawn, 50);
	expect(required(interpolation.frame(50)[0]).state.x).toBe(30);
	const restarted = packet(6, 20);
	required(restarted.peers[0]).state.falls = 1;
	required(restarted.peers[0]).state.ticks = 1;
	interpolation.receive(restarted, 100);
	expect(required(interpolation.frame(100)[0]).state.x).toBe(20);
});

test("interpolation adjusts clock drift without draining its buffer during a long session", () => {
	const game = new GameSimulation(map),
		interpolation = new PeerInterpolation(60);
	let x = 0;
	for (let now = 0; now <= 11_000; now++) {
		if (now % 55 === 0) {
			const index = now / 55,
				packet = snapshot(game, index * 3, 0);
			packet.peers = [
				{
					playerId: "peer",
					positionRevision: 0,
					nickname: "Peer",
					colorSlot: 1,
					crown: "NONE" as const,
					status: "ACTIVE",
					state: {
						...game.physics.snapshot(),
						x: index * 10,
						ticks: index * 3,
					},
				},
			];
			interpolation.receive(packet, now);
		}
		x = required(interpolation.frame(now)[0]).state.x;
	}
	expect(x).toBeGreaterThan(1970);
	expect(x).toBeLessThan(1999);
});
test("runtime ignores stale snapshots and clears sequence/prediction on generation change", () => {
	const socket = new GameSocket(
		() => {},
		() => {},
	);
	socket.selfId = "self";
	socket.input = vi.fn();
	const server = new GameSimulation(map),
		runtime = new OnlineRuntime(
			map,
			socket,
			room,
			() => right,
			() => {},
			false,
		);
	runtime.receive(snapshot(server, 1, 0) as unknown as Record<string, unknown>);
	runtime.advance(51);
	expect(runtime.game.physics.snapshot().x).toBeGreaterThan(map.spawn.x);
	expect(socket.input).toHaveBeenCalledTimes(3);
	server.tick(right);
	runtime.receive(snapshot(server, 2, 1) as unknown as Record<string, unknown>);
	const corrected = runtime.game.snapshot();
	runtime.receive(snapshot(server, 1, 0) as unknown as Record<string, unknown>);
	expect(runtime.game.snapshot()).toEqual(corrected);
	runtime.receive(
		snapshot(server, 2, 0, 2) as unknown as Record<string, unknown>,
	);
	runtime.advance(17);
	expect(socket.input).toHaveBeenLastCalledWith(
		"PLAYER_INPUT",
		expect.objectContaining({ generation: 2, seq: 1 }),
	);
	runtime.receive(
		snapshot(server, 100, 2, 1) as unknown as Record<string, unknown>,
	);
	expect(required(runtime.latest).generation).toBe(2);
	socket.playContext = { playId: "run", generation: 3 };
	const count = vi.mocked(socket.input).mock.calls.length;
	runtime.advance(100);
	runtime.cancel();
	expect(socket.input).toHaveBeenCalledTimes(count);
	runtime.receive({
		...snapshot(server, 101, 1, 2),
		self: { ...snapshot(server, 101, 1, 2).self, paused: true },
	} as unknown as Record<string, unknown>);
	expect(required(runtime.latest).serverTick).toBe(2);
});

test("self movement sounds follow prediction before ACK and never replay during reconciliation", () => {
	const socket = new GameSocket(
		() => {},
		() => {},
	);
	socket.selfId = "self";
	socket.input = vi.fn();
	const server = new GameSimulation(map);
	server.tick({ left: false, right: false, jump: false });
	let jump = true;
	const heard: string[] = [];
	const runtime = new OnlineRuntime(
		map,
		socket,
		room,
		() => ({ left: false, right: false, jump }),
		() => {},
		false,
		() => {},
		(events) => heard.push(...events),
	);
	runtime.receive(snapshot(server, 1, 0) as unknown as Record<string, unknown>);
	runtime.advance(1000 / 60);
	jump = false;
	runtime.advance(1000 / 60);
	expect(heard.filter((e) => e === "JUMP")).toHaveLength(1);
	const count = heard.length;
	// Chưa ACK input nào: reconcile phải replay cả cú nhảy nhưng không phát lại tiếng.
	runtime.receive(snapshot(server, 2, 0) as unknown as Record<string, unknown>);
	expect(heard).toHaveLength(count);
	runtime.menu = true;
	runtime.advance(100);
	expect(heard).toHaveLength(count);
});
