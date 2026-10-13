import { PHYSICS } from "../../game/simulation/tuning";
import type { HistoryItem, Statistics } from "../../network/contracts";
import { EMPTY_STATS } from "../../network/contracts";
import type { SoloRun } from "../solo/storage";

export const ticksToMs = (ticks: number) =>
	Math.floor((ticks * 1000) / PHYSICS.tickRate);
export function duration(ms: number | null): string {
	if (ms === null) return "—";
	const seconds = Math.floor(ms / 1000),
		minutes = Math.floor(seconds / 60),
		hours = Math.floor(minutes / 60);
	return `${hours ? hours + ":" : ""}${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function soloStatistics(runs: SoloRun[]): Statistics {
	const total = { ...EMPTY_STATS };
	let ticks = 0;
	for (const run of runs) {
		ticks += run.playTicks;
		total.totalJumps += run.jumps;
		total.totalFalls += run.falls;
		if (run.status === "FINISHED") {
			total.finishes++;
			const finish = ticksToMs(run.finishTicks!);
			total.bestFinishTimeMs =
				total.bestFinishTimeMs === null
					? finish
					: Math.min(total.bestFinishTimeMs, finish);
		}
	}
	total.totalPlayTimeMs = ticksToMs(ticks);
	return total;
}
export function soloHistory(runs: SoloRun[]): HistoryItem[] {
	return runs
		.filter((run) => run.status !== "ACTIVE")
		.map<HistoryItem>((run) => ({
			id: run.id,
			kind: "SOLO",
			status: run.status,
			startedAt: run.startedAt,
			endedAt: run.endedAt!,
			playTimeMs: ticksToMs(run.playTicks),
			jumps: run.jumps,
			falls: run.falls,
			currentProgress: run.currentProgress,
			maxProgress: run.maxProgress,
			finishTimeMs:
				run.finishTicks === null ? null : ticksToMs(run.finishTicks),
			room: null,
		}))
		.sort(
			(a, b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id),
		);
}
