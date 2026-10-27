import type { MovementEffect } from "../simulation/types";

export interface PlayerEffect {
	eventSeq: number;
	playerId: string;
	playId: string;
	screen: number;
	effect: MovementEffect;
	terrain: "NORMAL" | "ICE" | "SNOW";
}
export class PlayerEffects {
	private room = "";
	private last = 0;
	receive(
		payload: Record<string, unknown>,
		roomId: string,
		selfId: string,
		playId: string,
		screen: number,
		predictedPlayerId?: string,
	): PlayerEffect[] {
		if (payload.roomId !== roomId || !Array.isArray(payload.events)) return [];
		if (this.room !== roomId) {
			this.room = roomId;
			this.last = 0;
		}
		const result: PlayerEffect[] = [];
		for (const value of payload.events as PlayerEffect[]) {
			if (
				!value ||
				!Number.isSafeInteger(value.eventSeq) ||
				value.eventSeq < 1 ||
				typeof value.playerId !== "string" ||
				typeof value.playId !== "string" ||
				!Number.isInteger(value.screen) ||
				!["JUMP", "LAND", "SPLAT", "BUMP"].includes(value.effect) ||
				!["NORMAL", "ICE", "SNOW"].includes(value.terrain)
			)
				throw new Error("Invalid player effect");
			if (value.eventSeq <= this.last) continue;
			this.last = value.eventSeq;
			// Âm thanh bản thân đã phát ở prediction; vẫn đánh dấu sequence để không replay.
			if (value.playerId === predictedPlayerId) continue;
			if (
				value.playerId === selfId
					? value.playId === playId
					: value.screen === screen
			)
				result.push(value);
		}
		return result;
	}
}
