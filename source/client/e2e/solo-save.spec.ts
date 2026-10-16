import { expect, test } from "@playwright/test";
import type { PlayerState } from "../src/game/simulation/types";
import { soloJumps } from "./support/solo";

test("Solo saves, continues and archives replaced runs without losing totals", async ({
	page,
}) => {
	await page.goto("/");
	await page
		.getByRole("button", { name: "New Solo Game", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await page.keyboard.down("Space");
	await expect.poll(() => soloJumps(page)).toBe(1);
	await page.keyboard.up("Space");
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Continue Solo", exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Continue Solo", exact: true })
		.click();
	await expect.poll(() => soloJumps(page)).toBe(1);
	await page.keyboard.down("Space");
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	await page.reload();
	await page.keyboard.up("Space");
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await expect.poll(() => soloJumps(page)).toBe(1);
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	page.once("dialog", (dialog) => dialog.accept());
	await page
		.getByRole("button", { name: "New Solo Game", exact: true })
		.click();
	await expect.poll(() => soloJumps(page)).toBe(0);
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await page.getByRole("button", { name: "History", exact: true }).click();
	await expect(
		page.getByRole("button").filter({ hasText: "ABANDONED" }),
	).toHaveCount(1);
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Continue Solo", exact: true }),
	).toBeVisible();
	await expect(
		page
			.getByLabel("Total statistics")
			.getByText("Jumps", { exact: true })
			.locator("..")
			.locator("dd"),
	).toHaveText("1");
});

test("blocked storage permits a session without claiming it was saved", async ({
	page,
}) => {
	await page.addInitScript(() =>
		Object.defineProperty(globalThis, "indexedDB", {
			configurable: true,
			value: undefined,
		}),
	);
	await page.goto("/play");
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("alert")).toContainText("cannot be saved");
	await page.keyboard.down("Space");
	await expect(page.getByLabel("Play time", { exact: true })).toBeVisible();
	await expect
		.poll(() => page.getByLabel("Play time", { exact: true }).textContent())
		.not.toBe("00:00");
	await page.keyboard.up("Space");
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(page.getByText("Save failed", { exact: true })).toBeVisible();
	await expect(page.getByText("Saved", { exact: true })).toBeHidden();
});

test("real IndexedDB enforces writer ownership, revision and profile separation", async ({
	page,
}) => {
	await page.goto("/");
	const result = await page.evaluate(async () => {
		const storagePath = "/src/features/solo/storage.ts";
		const simulationPath = "/src/game/simulation/GameSimulation.ts";
		const { SoloWriter, soloRuns } = await import(storagePath);
		const { GameSimulation: Simulation } = await import(simulationPath);
		const map = await (await fetch("/shared/maps/main-babe.json")).json();
		const sim = new Simulation(map),
			initial = sim.snapshot();
		const first = await SoloWriter.open("writer-test", "new", initial);
		let rejected = false;
		try {
			await SoloWriter.open("writer-test", "continue", initial);
		} catch {
			rejected = true;
		}
		for (let i = 0; i < 60; i++)
			sim.tick({ left: false, right: false, jump: i < 36 });
		first.observe(sim.snapshot(), map.progressOriginY, false);
		const saved = await first.save();
		await first.close();
		const resumed = await SoloWriter.open("writer-test", "continue", initial);
		const sameId = resumed.run.id === saved.id;
		await resumed.close();
		const account = await SoloWriter.open("account-test", "new", initial);
		await account.close();
		return {
			rejected,
			sameId,
			jumps: saved.jumps,
			revision: saved.revision,
			accountRuns: (await soloRuns("account-test")).length,
			guestRuns: (await soloRuns("writer-test")).length,
		};
	});
	expect(result).toMatchObject({
		rejected: true,
		sameId: true,
		jumps: 1,
		accountRuns: 1,
		guestRuns: 1,
	});
	expect(result.revision).toBeGreaterThan(1);
});

test("pending sync survives reopen and late acknowledgements preserve newer revisions", async ({
	page,
}) => {
	await page.goto("/");
	const result = await page.evaluate(async () => {
		const path = "/src/features/solo/storage.ts",
			simulationPath = "/src/game/simulation/GameSimulation.ts";
		const { SoloWriter, pendingSoloRuns, acknowledgeSolo, soloRuns } =
			await import(path);
		const { GameSimulation: Simulation } = await import(simulationPath);
		const map = await (await fetch("/shared/maps/main-babe.json")).json(),
			simulation = new Simulation(map);
		const writer = await SoloWriter.open(
			"sync-account",
			"new",
			simulation.snapshot(),
		);
		const first = writer.run;
		simulation.tick({ left: false, right: false, jump: false });
		writer.observe(simulation.snapshot(), map.progressOriginY, false);
		const second = await writer.save();
		await writer.close();
		await acknowledgeSolo("sync-account", first.id, first.revision);
		const pending = await pendingSoloRuns("sync-account");
		let wrongOwner = false,
			future = false;
		try {
			await acknowledgeSolo("other-account", first.id, second.revision);
		} catch {
			wrongOwner = true;
		}
		try {
			await acknowledgeSolo("sync-account", first.id, second.revision + 1);
		} catch {
			future = true;
		}
		await acknowledgeSolo("sync-account", first.id, second.revision);
		await acknowledgeSolo("sync-account", first.id, first.revision);
		const [stored] = await soloRuns("sync-account");
		return {
			wrongOwner,
			future,
			pending: pending.length,
			revision: pending[0].revision,
			synced: pending[0].syncedRevision,
			remaining: (await pendingSoloRuns("sync-account")).length,
			finalSynced: stored.syncedRevision,
		};
	});
	expect(result).toMatchObject({
		wrongOwner: true,
		future: true,
		pending: 1,
		synced: 1,
		remaining: 0,
	});
	expect(result.revision).toBeGreaterThan(result.synced);
	expect(result.finalSynced).toBe(result.revision);
});

test("Solo keeps the last valid landed progress through flight and Continue", async ({
	page,
}) => {
	await page.goto("/");
	const result = await page.evaluate(async () => {
		const storagePath = "/src/features/solo/storage.ts",
			simulationPath = "/src/game/simulation/GameSimulation.ts";
		const { SoloWriter } = await import(storagePath);
		const { GameSimulation: Simulation } = await import(simulationPath);
		const map = await (await fetch("/shared/maps/main-babe.json")).json(),
			simulation = new Simulation(map),
			initial = simulation.snapshot();
		const writer = await SoloWriter.open("landed-progress", "new", initial);
		const observations: Record<string, number> = {};
		let ticks = 0;
		const observe = (
			name: string,
			progress: number,
			flags: Partial<PlayerState> = {},
		) => {
			const snapshot = structuredClone(initial);
			Object.assign(snapshot.physics, {
				y: initial.physics.y - progress,
				ticks: ++ticks,
				...flags,
			});
			snapshot.world.lastTick = ticks;
			writer.observe(snapshot, map.progressOriginY, false);
			observations[name] = writer.run.currentProgress;
		};
		observe("firstLanding", 80);
		observe("rising", 150, { grounded: false, vy: -3.5, jumps: 1 });
		observe("apex", 180, { grounded: false, vy: 0, jumps: 1 });
		observe("falling", 120, { grounded: false, vy: 3.5, jumps: 1 });
		observe("splat", 20, { splat: 1, falls: 1 });
		observe("phasingFall", 40, { phasingFall: true });
		observe("higherLanding", 100);
		observe("lowerLanding", 30);
		observe("belowOrigin", -10);
		observe("lastLanding", 60);
		observe("savedAirborne", 190, { grounded: false, vy: -2, jumps: 2 });
		const saved = await writer.save();
		await writer.close();
		const continued = await SoloWriter.open(
			"landed-progress",
			"continue",
			initial,
		);
		const restored = continued.run;
		simulation.restore(restored.snapshot);
		continued.observe(simulation.snapshot(), map.progressOriginY, false);
		const continuedProgress = continued.run.currentProgress;
		await continued.close();
		return {
			observations,
			continuedProgress,
			sameRun: saved.id === restored.id,
			sameSnapshot:
				JSON.stringify(saved.snapshot) === JSON.stringify(restored.snapshot),
			grounded: restored.snapshot.physics.grounded,
			maxProgress: restored.maxProgress,
			peakReachedTicks: restored.peakReachedTicks,
		};
	});
	expect(result).toEqual({
		observations: {
			firstLanding: 80,
			rising: 80,
			apex: 80,
			falling: 80,
			splat: 80,
			phasingFall: 80,
			higherLanding: 100,
			lowerLanding: 30,
			belowOrigin: 0,
			lastLanding: 60,
			savedAirborne: 60,
		},
		continuedProgress: 60,
		sameRun: true,
		sameSnapshot: true,
		grounded: false,
		maxProgress: 190,
		peakReachedTicks: 11,
	});
});

test("blur cancels charging and the AFK deadline pauses without a release jump", async ({
	page,
}) => {
	await page.clock.install();
	await page.goto("/play");
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await page.keyboard.down("Space");
	await page.clock.runFor(100);
	await page.evaluate(() => window.dispatchEvent(new Event("blur")));
	await page.keyboard.up("Space");
	await expect(
		page.getByRole("heading", { name: "Paused", exact: true }),
	).toBeVisible();
	await expect.poll(() => soloJumps(page)).toBe(0);
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	await page.clock.fastForward(60001);
	await expect(
		page.getByRole("heading", { name: "Paused", exact: true }),
	).toBeVisible();
	await expect.poll(() => soloJumps(page)).toBe(0);
});
