import rules from "../../../../common/rules.json";
import { NETWORK } from "../../network/config";
import type { PlayerStanding } from "../../network/contracts";
import type { GameSocket, RoomState } from "../../network/GameSocket";
import { PRESENTATION } from "../presentation/config";
import type {
	EndingSignal,
	GameRuntime,
	RenderPlayer,
	RenderPose,
	WorldFrame,
} from "../presentation/types";
import { findFinishPlatform } from "../simulation/finishPlatform";
import {
	GameSimulation,
	type GameSnapshot,
} from "../simulation/GameSimulation";
import { roomMap } from "../simulation/roomMaps";
import { PHYSICS } from "../simulation/tuning";
import type { GameMap, PlayerInput, PlayerState } from "../simulation/types";
import { PeerInterpolation } from "./PeerInterpolation";
import { Prediction } from "./Prediction";

export interface OnlineSnapshot {
	players?: PlayerStanding[];
	roomId: string;
	serverTick: number;
	playId: string;
	generation: number;
	elapsedTimeMs: number;
	remainingTimeMs: number | null;
	self: {
		lastProcessedInputSeq: number;
		status: string;
		paused: boolean;
		simulation: GameSnapshot;
		metrics: Record<string, unknown>;
	};
	peers: {
		playerId: string;
		nickname: string;
		colorSlot: number;
		state: RenderPose;
		crowned: boolean;
		status: string;
	}[];
}
export class OnlineRuntime implements GameRuntime {
	readonly game: GameSimulation;
	readonly finishMarker: GameRuntime["finishMarker"];
	latest: OnlineSnapshot | null = null;
	menu = false;
	private ending?: EndingSignal;
	private desiredFlight: boolean | undefined;
	private accumulatedMs = 0;
	private sequence = 0;
	private prediction: Prediction;
	private peers = new PeerInterpolation(PHYSICS.tickRate);
	constructor(
		map: GameMap,
		private socket: GameSocket,
		private room: RoomState,
		private readInput: () => PlayerInput,
		private changed: (state: PlayerState, snapshot: OnlineSnapshot) => void,
		flyAllowed: boolean,
		private failed: (message: string) => void = () => {},
	) {
		this.game = new GameSimulation(
			room.kind === "ROOM" ? roomMap(map, room.settings?.mapLevel ?? 10) : map,
			flyAllowed,
			room.settings?.mode === "NO_WALK",
		);
		if (room.kind === "ROOM")
			this.finishMarker =
				this.game.physics.finishPlatform ??
				findFinishPlatform(this.game.physics.map);
		this.prediction = new Prediction(
			this.game,
			NETWORK.maxInputFrames,
			room.settings?.mode === "HARDCORE",
		);
	}
	updateRoom(room: RoomState): void {
		this.room = room;
	}
	get flying(): boolean {
		return this.desiredFlight ?? this.game.physics.snapshot().freeFlight;
	}
	setFlight(enabled: boolean): void {
		this.desiredFlight = this.game.physics.flyAllowed && enabled;
		this.game.physics.setFlight(this.desiredFlight);
	}
	finish(payload: Record<string, unknown>): void {
		if (
			payload.playerId !== this.socket.selfId ||
			payload.showEnding !== true ||
			typeof payload.playId !== "string"
		)
			return;
		if (
			this.socket.playContext &&
			payload.playId !== this.socket.playContext.playId
		)
			return;
		const ending = payload.ending as Partial<EndingSignal> | undefined;
		if (
			!ending ||
			!Number.isInteger(ending.screen) ||
			ending.screen !== this.game.physics.map.finish.screen
		)
			throw new Error("Invalid ending state");
		this.ending ??= { id: payload.playId, screen: ending.screen! };
	}
	receive(payload: Record<string, unknown>): void {
		const value = payload as unknown as OnlineSnapshot;
		if (
			value.roomId !== this.room.roomId ||
			!Number.isSafeInteger(value.serverTick) ||
			value.serverTick < 0 ||
			!Number.isSafeInteger(value.generation) ||
			value.generation < 1 ||
			typeof value.playId !== "string"
		)
			throw new Error("Invalid game snapshot");
		if (
			this.socket.playContext &&
			(value.playId !== this.socket.playContext.playId ||
				value.generation < this.socket.playContext.generation)
		)
			return;
		if (
			this.latest &&
			value.playId === this.latest.playId &&
			value.generation === this.latest.generation &&
			value.serverTick <= this.latest.serverTick
		)
			return;
		if (
			this.latest &&
			value.playId === this.latest.playId &&
			value.generation < this.latest.generation
		)
			return;
		if (
			!this.latest ||
			value.playId !== this.latest.playId ||
			value.generation !== this.latest.generation
		) {
			this.sequence = value.self.lastProcessedInputSeq;
			this.accumulatedMs = 0;
			this.prediction.reset();
			this.peers.reset();
		}
		if (value.self.lastProcessedInputSeq > this.sequence)
			throw new Error("Server acknowledged an unsent input");
		if (!this.latest || value.playId !== this.latest.playId)
			this.desiredFlight = value.self.simulation.physics.freeFlight;
		if (value.self.paused) this.prediction.reset();
		this.prediction.reconcile(
			value.self.simulation,
			value.self.lastProcessedInputSeq,
			!this.menu && !value.self.paused && value.self.status === "ACTIVE",
		);
		this.peers.receive(value, performance.now());
		this.latest = value;
		this.changed(this.game.physics.snapshot(), value);
		if (this.ending && this.ending.id !== value.playId) this.ending = undefined;
	}
	advance(deltaMs: number): void {
		if (
			!this.latest ||
			this.menu ||
			this.latest.self.paused ||
			this.latest.self.status !== "ACTIVE"
		) {
			this.accumulatedMs = 0;
			return;
		}
		if (
			this.socket.playContext &&
			(this.latest.playId !== this.socket.playContext.playId ||
				this.latest.generation !== this.socket.playContext.generation)
		) {
			this.accumulatedMs = 0;
			return;
		}
		this.accumulatedMs += Math.max(
			0,
			Math.min(PRESENTATION.maxFrameMs, deltaMs),
		);
		const step = 1000 / PHYSICS.tickRate;
		while (this.accumulatedMs >= step) {
			this.accumulatedMs -= step;
			const input = { ...this.readInput(), freeFlight: this.flying };
			if (this.menu) break;
			const seq = ++this.sequence;
			try {
				this.prediction.push(seq, input);
			} catch (cause) {
				this.menu = true;
				this.socket.close();
				this.failed(
					cause instanceof Error ? cause.message : "Input queue is full",
				);
				return;
			}
			this.socket.input("PLAYER_INPUT", {
				playId: this.latest.playId,
				generation: this.latest.generation,
				seq,
				...input,
			});
		}
	}
	cancel(): void {
		if (!this.latest) return;
		if (
			this.socket.playContext &&
			(this.latest.playId !== this.socket.playContext.playId ||
				this.latest.generation !== this.socket.playContext.generation)
		)
			return;
		const seq = ++this.sequence;
		this.prediction.cancel(seq);
		this.socket.input("CANCEL_INPUT", {
			playId: this.latest.playId,
			generation: this.latest.generation,
			seq,
		});
	}
	frame(): WorldFrame {
		const saved = this.game.snapshot(),
			self = this.room.members.find(
				(member) => member.playerId === this.socket.selfId,
			);
		const color = (slot: number) =>
			rules.appearanceColors[slot] || rules.appearanceColors[0]!;
		const peers: RenderPlayer[] = this.peers
			.frame(performance.now())
			.map((peer) => ({
				id: peer.playerId,
				nickname: peer.nickname,
				color: color(peer.colorSlot),
				state: peer.state,
				crowned: peer.crowned,
			}));
		return {
			self: {
				id: this.socket.selfId || "self",
				nickname: self?.nickname || "Player",
				color: color(self?.colorSlot || 0),
				state: saved.physics,
				crowned: this.game.adventure.completed,
				adventure: saved.adventure,
			},
			peers,
			world: saved.world,
			...(this.ending?.id === this.latest?.playId &&
			this.latest?.self.status === "FINISHED"
				? { ending: this.ending }
				: {}),
		};
	}
}
