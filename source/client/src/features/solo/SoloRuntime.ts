import rules from "../../../../common/rules.json";
import { PRESENTATION } from "../../game/presentation/config";
import type {
	EndingSignal,
	GameRuntime,
	WorldFrame,
} from "../../game/presentation/types";
import type { AdventureEvent } from "../../game/simulation/Adventure";
import {
	GameSimulation,
	type GameSnapshot,
	type WorldEvent,
} from "../../game/simulation/GameSimulation";
import type { Simulation } from "../../game/simulation/Simulation";
import { PHYSICS } from "../../game/simulation/tuning";
import type {
	GameMap,
	MovementEffect,
	PlayerInput,
	PlayerState,
} from "../../game/simulation/types";

export class SoloRuntime implements GameRuntime {
	readonly game: GameSimulation;
	readonly simulation: Simulation;
	paused = false;
	private accumulatedMs = 0;
	private ending?: EndingSignal;
	constructor(
		map: GameMap,
		private readInput: () => PlayerInput,
		private onTick: (state: PlayerState) => void,
		readonly nickname = "Player",
		private onEffects: (
			effects: MovementEffect[],
			state: PlayerState,
		) => void = () => {},
		private onEvents: (
			events: AdventureEvent[],
			world: WorldEvent[],
		) => void = () => {},
	) {
		this.game = new GameSimulation(map, __SOLO_FLY_ENABLED__);
		this.simulation = this.game.physics;
	}
	advance(deltaMs: number): void {
		if (this.simulation.finished && !this.ending) {
			this.finish();
			this.onTick(this.simulation.snapshot());
		}
		if (this.paused || this.simulation.finished) {
			this.accumulatedMs = 0;
			return;
		}
		this.accumulatedMs += Math.max(
			0,
			Math.min(PRESENTATION.maxFrameMs, deltaMs),
		);
		const step = 1000 / PHYSICS.tickRate;
		while (
			this.accumulatedMs >= step &&
			!this.simulation.finished &&
			!this.paused
		) {
			const input = this.readInput();
			if (this.paused) break;
			const events = this.game.tick(input);
			this.accumulatedMs -= step;
			if (this.simulation.finished) this.finish();
			const state = this.simulation.snapshot();
			this.onEffects(events.movement, state);
			this.onEvents(events.adventure, events.world);
			this.onTick(state);
		}
	}
	private finish(): void {
		if (this.ending) return;
		this.game.adventure.complete();
		this.ending = {
			id: "solo-finish",
			screen: this.simulation.snapshot().screen,
		};
	}
	restore(snapshot: GameSnapshot): void {
		this.game.restore(snapshot);
		this.simulation.cancelInput();
		if (this.simulation.finished) this.finish();
	}
	pause(): void {
		this.paused = true;
		this.accumulatedMs = 0;
		this.simulation.cancelInput();
	}
	resume(): void {
		this.paused = false;
		this.accumulatedMs = 0;
	}
	frame(): WorldFrame {
		const snapshot = this.game.snapshot();
		return {
			self: {
				id: "self",
				nickname: this.nickname,
				color: rules.appearanceColors[0]!,
				crowned: this.game.adventure.completed,
				state: snapshot.physics,
				adventure: snapshot.adventure,
			},
			peers: [],
			world: snapshot.world,
			...(this.ending ? { ending: this.ending } : {}),
		};
	}
}
