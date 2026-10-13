import { expect, test } from "vitest";
import expected from "../../../../common/fixtures/ending-paths.json";
import { ENDING_FRAMES, ENDING_PATHS } from "./endingFrames";

test("ending jump paths retain every independent native float32 coordinate", () => {
	expect(JSON.parse(JSON.stringify(ENDING_PATHS))).toEqual(expected);
	expect(Object.is(ENDING_PATHS.full[0], -0)).toBe(true);
	expect(
		Object.keys(ENDING_FRAMES).some((name) =>
			/nbp|owl|intro|credit/i.test(name),
		),
	).toBe(false);
	for (const frame of Object.values(ENDING_FRAMES)) {
		expect(frame.width).toBeGreaterThan(0);
		expect(frame.height).toBeGreaterThan(0);
		expect(
			Number.isFinite(frame.originX) && Number.isFinite(frame.originY),
		).toBe(true);
	}
});
