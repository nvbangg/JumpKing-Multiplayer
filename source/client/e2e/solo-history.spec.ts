import { expect, test } from "@playwright/test";
import checkpoints from "../../common/fixtures/main-babe-checkpoints.json" with {
	type: "json",
};

test("finished Solo stays in History and profile totals after a fresh game", async ({
	page,
}) => {
	await page.goto("/");
	const result = await page.evaluate(async (finish) => {
		const path = "/src/features/solo/storage.ts",
			simulationPath = "/src/game/simulation/GameSimulation.ts",
			formatPath = "/src/features/records/format.ts";
		const { SoloWriter, currentSolo, soloRuns } = await import(path);
		const { GameSimulation: Simulation } = await import(simulationPath);
		const { soloHistory, soloStatistics } = await import(formatPath);
		const map = await (await fetch("/shared/maps/main-babe.json")).json(),
			simulation = new Simulation(map);
		const writer = await SoloWriter.open(
			"history-account",
			"new",
			simulation.snapshot(),
		);
		simulation.physics.restore(finish);
		simulation.adventure.complete();
		writer.observe(
			simulation.snapshot(),
			map.progressOriginY,
			simulation.finished,
		);
		const saved = await writer.save();
		await writer.close();
		const hasContinue = await currentSolo("history-account");
		const next = await SoloWriter.open(
			"history-account",
			"new",
			new Simulation(map).snapshot(),
		);
		await next.close();
		const rows = await soloRuns("history-account");
		return {
			hasContinue,
			savedSnapshot: saved.snapshot,
			history: soloHistory(rows),
			statistics: soloStatistics(rows),
			otherProfile: (await soloRuns("guest")).length,
			distinctIds: new Set(rows.map((row: { id: string }) => row.id)).size,
		};
	}, checkpoints.at(-1)!);
	expect(result.hasContinue).toBeNull();
	expect(result.savedSnapshot).toBeNull();
	expect(result.history).toHaveLength(1);
	expect(result.history[0]).toMatchObject({
		status: "FINISHED",
		kind: "SOLO",
		jumps: 228,
		falls: 0,
	});
	expect(result.statistics).toMatchObject({
		finishes: 1,
		totalJumps: 228,
		bestFinishTimeMs: 282616,
	});
	expect(result.otherProfile).toBe(0);
	expect(result.distinctIds).toBe(2);
});
