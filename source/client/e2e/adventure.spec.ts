import { expect, test } from "@playwright/test";
import checkpoints from "../../common/fixtures/main-babe-checkpoints.json" with {
	type: "json",
};
import { soloJumps } from "./support/solo";

test("legacy item save retains run, dialogue and earned crown without Inventory", async ({
	page,
}) => {
	await page.goto("/assets/title_logo.png");
	await page.evaluate(async () => {
		const path = "/src/game/simulation/GameSimulation.ts",
			{ GameSimulation } = await import(path);
		const map = await (await fetch("/shared/maps/main-babe.json")).json(),
			snapshot = new GameSimulation(map).snapshot();
		Object.assign(snapshot.adventure, {
			codecVersion: 1,
			inventory: { Cap: 1 },
			equipped: ["Cap"],
			collected: [],
			birds: {},
			merchants: {},
		});
		snapshot.adventure.dialogue.old_man.introduced = true;
		await new Promise<void>((resolve, reject) => {
			const open = indexedDB.open("jumpking", 2);
			open.onupgradeneeded = () => {
				open.result.createObjectStore("profiles", { keyPath: "key" });
				open.result
					.createObjectStore("runs", { keyPath: "id" })
					.createIndex("profile", "profile");
			};
			open.onerror = () => reject(open.error);
			open.onsuccess = () => {
				const db = open.result,
					tx = db.transaction(["profiles", "runs"], "readwrite");
				tx.objectStore("profiles").put({
					key: "guest",
					activeRunId: "item-save",
					writerId: null,
					leaseExpiresAt: 0,
					wardrobe: ["Cap", "Crown"],
					equipped: ["Cap"],
				});
				tx.objectStore("runs").put({
					id: "item-save",
					profile: "guest",
					revision: 7,
					syncedRevision: 4,
					status: "ACTIVE",
					playTicks: 0,
					jumps: 0,
					falls: 0,
					currentProgress: 0,
					maxProgress: 0,
					peakReachedTicks: 0,
					finishTicks: null,
					startedAt: "2026-01-01T00:00:00.000Z",
					endedAt: null,
					snapshot,
				});
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
		});
	});
	await page.goto("/");
	await page
		.getByRole("button", { name: "Continue Solo", exact: true })
		.click();
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Inventory", exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	const restored = await page.evaluate(async () => {
		const path = "/src/features/solo/storage.ts",
			{ currentSolo, openStore } = await import(path);
		const run = await currentSolo("guest"),
			db = await openStore();
		const profile = await new Promise((resolve) => {
			const req = db
				.transaction("profiles")
				.objectStore("profiles")
				.get("guest");
			req.onsuccess = () => resolve(req.result);
		});
		db.close();
		return { run, profile };
	});
	expect(restored.run).toMatchObject({
		id: "item-save",
		syncedRevision: 4,
		snapshot: {
			adventure: {
				codecVersion: 2,
				dialogue: { old_man: { introduced: true } },
			},
		},
	});
	expect(restored.profile).toMatchObject({ crownUnlocked: true });
	expect(restored.profile).not.toHaveProperty("wardrobe");
	expect(restored.profile).not.toHaveProperty("equipped");
	expect(restored.run.snapshot.adventure).not.toHaveProperty("inventory");
});

test("IndexedDB upgrades physics-only saves without deleting run identity or totals", async ({
	page,
}) => {
	await page.goto("/assets/title_logo.png");
	await page.evaluate(async (physics) => {
		await new Promise<void>((resolve, reject) => {
			const open = indexedDB.open("jumpking", 1);
			open.onupgradeneeded = () => {
				const db = open.result;
				db.createObjectStore("profiles", { keyPath: "key" });
				db.createObjectStore("runs", { keyPath: "id" }).createIndex(
					"profile",
					"profile",
				);
			};
			open.onerror = () => reject(open.error);
			open.onsuccess = () => {
				const db = open.result,
					tx = db.transaction(["profiles", "runs"], "readwrite");
				tx.objectStore("profiles").put({
					key: "guest",
					activeRunId: "old-run",
					writerId: null,
					leaseExpiresAt: 0,
				});
				tx.objectStore("runs").put({
					id: "old-run",
					profile: "guest",
					revision: 3,
					syncedRevision: 0,
					status: "ACTIVE",
					playTicks: physics.ticks,
					jumps: physics.jumps,
					falls: physics.falls,
					currentProgress: 144,
					maxProgress: 144,
					peakReachedTicks: physics.ticks,
					finishTicks: null,
					startedAt: "2026-01-01T00:00:00.000Z",
					endedAt: null,
					snapshot: physics,
				});
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
		});
	}, checkpoints[0]!);
	await page.goto("/");
	await page
		.getByRole("button", { name: "Continue Solo", exact: true })
		.click();
	await expect.poll(() => soloJumps(page)).toBe(1);
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	const restored = await page.evaluate(async () => {
		const path = "/src/features/solo/storage.ts",
			{ currentSolo } = await import(path);
		const run = await currentSolo("guest");
		return {
			id: run.id,
			jumps: run.jumps,
			ticks: run.playTicks,
			adventureCodec: run.snapshot.adventure.codecVersion,
			worldTick: run.snapshot.world.lastTick,
		};
	});
	expect(restored).toMatchObject({
		id: "old-run",
		jumps: 1,
		adventureCodec: 2,
	});
	expect(restored.ticks).toBeGreaterThanOrEqual(111);
	expect(restored.worldTick).toBe(restored.ticks);
});
