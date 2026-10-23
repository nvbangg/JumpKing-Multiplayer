import type {
	GameSimulation,
	GameSnapshot,
} from "../simulation/GameSimulation";
import type { PlayerInput } from "../simulation/types";

interface Frame {
	seq: number;
	input: PlayerInput;
	cancel: boolean;
}
export class Prediction {
	private frames: Frame[] = [];
	constructor(
		private game: GameSimulation,
		private maximum: number,
		private respawnOnSplat = false,
	) {}
	get pending(): number {
		return this.frames.length;
	}
	reset(): void {
		this.frames = [];
	}
	push(seq: number, input: PlayerInput) {
		if (this.frames.length >= this.maximum)
			throw new Error(
				"Input acknowledgements are too far behind; reconnect to continue",
			);
		this.frames.push({ seq, input: { ...input }, cancel: false });
		return this.game.tick(input, this.respawnOnSplat).movement;
	}
	cancel(seq: number): void {
		this.frames = [
			{ seq, input: { left: false, right: false, jump: false }, cancel: true },
		];
		this.game.physics.cancelInput();
	}
	reconcile(
		snapshot: GameSnapshot,
		acknowledged: number,
		replay: boolean,
	): void {
		if (!Number.isSafeInteger(acknowledged) || acknowledged < 0)
			throw new Error("Invalid input acknowledgement");
		this.frames = this.frames.filter((frame) => frame.seq > acknowledged);
		this.game.restore(snapshot);
		if (!replay) return;
		for (const frame of this.frames) {
			if (frame.cancel) this.game.physics.cancelInput();
			// Replay chỉ cập nhật simulation; presentation không nhận lại effects/ending.
			this.game.tick(frame.input, this.respawnOnSplat);
		}
	}
}
