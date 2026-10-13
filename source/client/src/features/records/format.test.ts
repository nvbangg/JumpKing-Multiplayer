import { expect, test } from "vitest";
import type { SoloRun } from "../solo/storage";
import { duration, soloHistory, soloStatistics } from "./format";

const run = (overrides: Partial<SoloRun>): SoloRun => ({
	id: "a",
	profile: "guest",
	revision: 1,
	syncedRevision: 0,
	status: "ACTIVE",
	playTicks: 60,
	jumps: 3,
	falls: 1,
	currentProgress: 0,
	maxProgress: 140,
	peakReachedTicks: 30,
	finishTicks: null,
	startedAt: "2026-01-01T00:00:00.000Z",
	endedAt: null,
	snapshot: null,
	...overrides,
});

test("totals retain abandoned and active attempts but best time only uses finishes", () => {
	const rows = [
		run({}),
		run({ id: "b", status: "ABANDONED", playTicks: 120 }),
		run({ id: "c", status: "FINISHED", playTicks: 180, finishTicks: 180 }),
		run({ id: "d", status: "FINISHED", playTicks: 90, finishTicks: 90 }),
	];
	expect(soloStatistics(rows)).toEqual({
		totalPlayTimeMs: 7500,
		totalJumps: 12,
		totalFalls: 4,
		finishes: 2,
		matchesPlayed: 0,
		wins: 0,
		bestFinishTimeMs: 1500,
	});
	expect(soloStatistics([rows[0]!]).bestFinishTimeMs).toBeNull();
	expect(
		soloStatistics([run({ playTicks: 1 }), run({ playTicks: 2 })])
			.totalPlayTimeMs,
	).toBe(50);
});

test("history excludes active saves and sorts terminal summaries without altering IDs", () => {
	const rows = [
		run({}),
		run({ id: "b", status: "ABANDONED", endedAt: "2026-01-01T00:01:00.000Z" }),
		run({
			id: "c",
			status: "FINISHED",
			finishTicks: 60,
			endedAt: "2026-01-01T00:02:00.000Z",
		}),
	];
	expect(
		soloHistory(rows).map((item) => [item.id, item.kind, item.finishTimeMs]),
	).toEqual([
		["c", "SOLO", 1000],
		["b", "SOLO", null],
	]);
	expect(rows[0]!.status).toBe("ACTIVE");
});

test("duration distinguishes no result, zero and elapsed hours", () => {
	expect(duration(null)).toBe("—");
	expect(duration(0)).toBe("00:00");
	expect(duration(3661999)).toBe("1:01:01");
});
