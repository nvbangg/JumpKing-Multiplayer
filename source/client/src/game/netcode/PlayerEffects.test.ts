import { expect, test } from "vitest";
import { PlayerEffects } from "./PlayerEffects";

test("effects are deduplicated per room, filter peer screens and ignore a previous self run", () => {
	const effects = new PlayerEffects();
	const event = {
		eventSeq: 1,
		playerId: "self",
		playId: "run",
		screen: 0,
		effect: "JUMP",
		terrain: "NORMAL",
	};
	const receive = (events: unknown[], roomId = "ABCDEF") =>
		effects.receive({ roomId, events }, roomId, "self", "run", 0);
	expect(receive([event])).toHaveLength(1);
	expect(receive([event])).toEqual([]);
	expect(
		receive([{ ...event, eventSeq: 2, playerId: "peer", screen: 1 }]),
	).toEqual([]);
	expect(receive([{ ...event, eventSeq: 3, playerId: "peer" }])).toHaveLength(
		1,
	);
	expect(receive([{ ...event, eventSeq: 4, playId: "old-run" }])).toEqual([]);
	expect(receive([event], "GHJKLM")).toHaveLength(1);
	expect(() =>
		receive([{ ...event, eventSeq: 5, effect: "TELEPORT" }]),
	).toThrow("Invalid");
});
