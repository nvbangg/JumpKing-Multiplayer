import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.skip(
	process.env.JK_NETCODE_EXPERIMENT !== "true",
	"Opt-in reproducible netcode experiment",
);
test("compares snapshot-only and prediction with the same deterministic delayed input stream", async ({
	page,
}) => {
	await page.goto("/");
	const measurements = await page.evaluate(async () => {
		const simulationPath = "/src/game/simulation/GameSimulation.ts",
			predictionPath = "/src/game/netcode/Prediction.ts";
		const { GameSimulation } = await import(simulationPath),
			{ Prediction } = await import(predictionPath);
		const map = await (await fetch("/shared/maps/main-babe.json")).json(),
			stepMs = 1000 / 60;
		const idle = { left: false, right: false, jump: false };
		const percentile = (values: number[]) => {
			const sorted = [...values].sort((a, b) => a - b);
			return {
				samples: sorted.length,
				p50: sorted[Math.ceil(sorted.length * 0.5) - 1]!,
				p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
				p99: sorted[Math.ceil(sorted.length * 0.99) - 1]!,
			};
		};
		return [0, 3, 6].map((delay) => {
			const server = new GameSimulation(map),
				predicted = new GameSimulation(map),
				baseline = new GameSimulation(map),
				reference = new GameSimulation(map);
			const predictor = new Prediction(predicted, 180),
				inputStream = Array.from({ length: 1800 }, (_, tick) => ({
					...idle,
					jump: tick % 120 >= 30 && tick % 120 < 50,
				}));
			const snapshots: {
				arrives: number;
				seq: number;
				state: ReturnType<typeof server.snapshot>;
			}[] = [];
			const inputLatency = {
					prediction: [] as number[],
					snapshotOnly: [] as number[],
				},
				errors = { prediction: [] as number[], snapshotOnly: [] as number[] },
				corrections: number[] = [];
			const launches = {
				prediction: new Map<number, number>(),
				snapshotOnly: new Map<number, number>(),
			};
			let serverSeq = 0,
				lastAccepted = 0;
			for (let tick = 0; tick < inputStream.length; tick++) {
				predictor.push(tick + 1, inputStream[tick]);
				reference.tick(inputStream[tick]);
				const source = tick - delay;
				if (source >= 0) {
					server.tick(inputStream[source]);
					serverSeq = source + 1;
				}
				if (tick % 3 === 0 && source >= 0)
					snapshots.push({
						arrives: tick + delay + [0, 2, 1, 0][(tick / 3) % 4]!,
						seq: serverSeq,
						state: server.snapshot(),
					});
				for (const packet of snapshots.filter(
					(value) => value.arrives === tick,
				)) {
					if (packet.seq <= lastAccepted) continue;
					lastAccepted = packet.seq;
					const before = predicted.physics.snapshot();
					predictor.reconcile(packet.state, packet.seq, true);
					const corrected = predicted.physics.snapshot();
					corrections.push(
						Math.hypot(before.x - corrected.x, before.y - corrected.y),
					);
					baseline.restore(packet.state);
				}
				for (const [kind, game] of [
					["prediction", predicted],
					["snapshotOnly", baseline],
				] as const) {
					const pose = game.physics.snapshot(),
						target = reference.physics.snapshot();
					errors[kind].push(Math.hypot(pose.x - target.x, pose.y - target.y));
					if (pose.jumps > 0 && !launches[kind].has(pose.jumps))
						launches[kind].set(pose.jumps, tick);
				}
			}
			for (const [number, tick] of launches.prediction) {
				const firstCharge = (number - 1) * 120 + 30;
				inputLatency.prediction.push((tick - firstCharge + 1) * stepMs);
				const remote = launches.snapshotOnly.get(number);
				if (remote !== undefined)
					inputLatency.snapshotOnly.push((remote - firstCharge + 1) * stepMs);
			}
			return {
				modelOneWayMs: delay * stepMs,
				jitterTicks: [0, 2, 1, 0],
				ticks: inputStream.length,
				jumpVisibleFromChargeMs: {
					prediction: percentile(inputLatency.prediction),
					snapshotOnly: percentile(inputLatency.snapshotOnly),
				},
				renderPositionErrorPixels: {
					prediction: percentile(errors.prediction),
					snapshotOnly: percentile(errors.snapshotOnly),
				},
				correctionsPixels: percentile(corrections),
				nonzeroCorrections: corrections.filter((value) => value > 0).length,
			};
		});
	});
	for (const sample of measurements) {
		expect(sample.renderPositionErrorPixels.prediction.p95).toBe(0);
		expect(sample.jumpVisibleFromChargeMs.prediction.p50).toBeLessThanOrEqual(
			sample.jumpVisibleFromChargeMs.snapshotOnly.p50,
		);
		if (sample.modelOneWayMs > 0)
			expect(sample.renderPositionErrorPixels.snapshotOnly.p95).toBeGreaterThan(
				0,
			);
	}
	await mkdir("../../.local/reports", { recursive: true });
	await writeFile(
		"../../.local/reports/netcode-experiment.json",
		JSON.stringify(
			{
				recordedAt: new Date().toISOString(),
				limitations: [
					"Controlled discrete transport model in Chrome; not a measured Internet latency",
					"Identical input and fixed 60 Hz simulation; no loss or clock drift; independent live workload measured separately",
					"Jump latency includes the same 21-tick charge in both variants",
				],
				measurements,
			},
			null,
			2,
		),
	);
});
