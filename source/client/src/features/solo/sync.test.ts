import { expect, test } from "vitest";
import type { SoloRun } from "./storage";
import { soloMetrics } from "./sync";

test("Solo upload contains only metrics, never profile, checkpoint or sync bookkeeping", () => {
	const run: SoloRun = {
		id: "run",
		profile: "private-profile",
		revision: 7,
		syncedRevision: 3,
		status: "ACTIVE",
		playTicks: 60,
		jumps: 1,
		falls: 0,
		currentProgress: 20,
		maxProgress: 50,
		peakReachedTicks: 40,
		finishTicks: null,
		startedAt: "2026-01-01T00:00:00.000Z",
		endedAt: null,
		snapshot: null,
	};
	expect(Object.keys(soloMetrics(run)).sort()).toEqual(
		[
			"revision",
			"status",
			"playTicks",
			"jumps",
			"falls",
			"currentProgress",
			"maxProgress",
			"peakReachedTicks",
			"finishTicks",
			"startedAt",
			"endedAt",
		].sort(),
	);
	expect(soloMetrics(run)).toMatchObject({ revision: 7, playTicks: 60 });
});
