import { expect, test } from "vitest";
import { AdventureEffects } from "./AdventureEffects";

test("private adventure cues deduplicate and ignore an old run or another room", () => {
	const effects = new AdventureEffects();
	const cue = { eventSeq: 1, kind: "ADVENTURE", type: "SPEECH", id: "world:0" };
	const receive = (events: unknown[], roomId = "ABCDEF", playId = "run") =>
		effects.receive({ roomId, playId, events }, "ABCDEF", "run");
	expect(receive([cue])).toEqual([cue]);
	expect(receive([cue])).toEqual([]);
	expect(receive([{ ...cue, eventSeq: 2 }], "GHJKLM")).toEqual([]);
	expect(receive([{ ...cue, eventSeq: 2 }], "ABCDEF", "old")).toEqual([]);
	expect(
		receive([{ ...cue, eventSeq: 2, kind: "WORLD", type: "WALL" }]),
	).toHaveLength(1);
	expect(() => receive([{ ...cue, eventSeq: 3, type: "UNKNOWN" }])).toThrow(
		"Invalid",
	);
	const flee = { ...cue, eventSeq: 3, type: "FLEE", id: "raven" };
	expect(receive([flee])).toEqual([flee]);
	expect(receive([flee])).toEqual([]);
});
