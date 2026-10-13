interface Cue {
	eventSeq: number;
	kind: "ADVENTURE" | "WORLD";
	type: string;
	id: string;
}
/** Chỉ phát cues server của lượt hiện tại; restore/replay snapshot không phát lại. */
export class AdventureEffects {
	private room = "";
	private last = 0;
	receive(
		payload: Record<string, unknown>,
		roomId: string,
		playId: string,
	): Cue[] {
		if (
			payload.roomId !== roomId ||
			payload.playId !== playId ||
			!Array.isArray(payload.events)
		)
			return [];
		if (this.room !== roomId) {
			this.room = roomId;
			this.last = 0;
		}
		const result: Cue[] = [];
		for (const cue of payload.events as Cue[]) {
			if (
				!cue ||
				!Number.isSafeInteger(cue.eventSeq) ||
				cue.eventSeq < 1 ||
				typeof cue.id !== "string" ||
				!(
					cue.kind === "WORLD"
						? ["WALL", "JINGLE"]
						: cue.kind === "ADVENTURE"
							? ["SPEECH"]
							: []
				).includes(cue.type)
			)
				throw new Error("Invalid adventure effect");
			if (cue.eventSeq <= this.last) continue;
			this.last = cue.eventSeq;
			result.push(cue);
		}
		return result;
	}
}
