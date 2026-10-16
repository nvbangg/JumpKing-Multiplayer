import { expect, test } from "@playwright/test";

test("Solo Continue preserves dialogue, run identity and earned crown", async ({
	page,
}) => {
	await page.goto("/");
	const id = await page.evaluate(async () => {
		const simulationPath = "/src/game/simulation/GameSimulation.ts";
		const storagePath = "/src/features/solo/storage.ts";
		const { GameSimulation } = await import(simulationPath);
		const { SoloWriter, rememberCrown } = await import(storagePath);
		const map = await (await fetch("/shared/maps/main-babe.json")).json();
		const game = new GameSimulation(map);
		const snapshot = game.snapshot();
		snapshot.adventure.dialogue.old_man.introduced = true;
		const writer = await SoloWriter.open("guest", "new", snapshot);
		writer.observe(snapshot, map.progressOriginY, false);
		await writer.save();
		const id = writer.run.id;
		await writer.close();
		await rememberCrown("guest");
		return id;
	});
	await page.reload();
	await page
		.getByRole("button", { name: "Continue Solo", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Inventory", exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	const restored = await page.evaluate(async () => {
		const storagePath = "/src/features/solo/storage.ts";
		const { currentSolo, hasCrown } = await import(storagePath);
		return { run: await currentSolo("guest"), crown: await hasCrown("guest") };
	});
	expect(restored.crown).toBe(true);
	expect(restored.run).toMatchObject({
		id,
		snapshot: {
			adventure: {
				codecVersion: 2,
				flags: ["CompletedNormalGame"],
				dialogue: { old_man: { introduced: true } },
			},
		},
	});
});
