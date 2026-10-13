import { expect, test } from "@playwright/test";
import checkpoints from "../../common/fixtures/main-babe-checkpoints.json" with {
	type: "json",
};

test("Solo Finish persists once, Skip shows the native picture and History stays finished", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (/Texture .* has no frame/.test(message.text()))
			errors.push(message.text());
	});
	await page.goto("/");
	await page.evaluate(async (finish) => {
		const storage = "/src/features/solo/storage.ts",
			simulation = "/src/game/simulation/GameSimulation.ts";
		const { SoloWriter } = await import(storage),
			{ GameSimulation } = await import(simulation);
		const map = await (await fetch("/shared/maps/main-babe.json")).json(),
			game = new GameSimulation(map);
		game.physics.restore(finish);
		const snapshot = game.snapshot();
		snapshot.world.lastTick = finish.ticks;
		const writer = await SoloWriter.open("guest", "new", snapshot);
		await writer.close();
	}, checkpoints.at(-1)!);
	await page.reload();
	await page
		.getByRole("button", { name: "Continue Solo", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Skip", exact: true }),
	).toBeVisible();
	await page.screenshot({ path: info.outputPath("ending-main-babe.png") });
	await page.getByRole("button", { name: "Skip", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Back to Menu", exact: true }),
	).toBeEnabled();
	await page.screenshot({ path: info.outputPath("ending-picture.png") });
	await page.getByRole("button", { name: "Back to Menu", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "New Solo Game", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Continue Solo", exact: true }),
	).toBeHidden();
	await page.getByRole("button", { name: "History", exact: true }).click();
	await expect(
		page.getByRole("button").filter({ hasText: "FINISHED" }),
	).toHaveCount(1);
	const result = await page.evaluate(async () => {
		const storage = "/src/features/solo/storage.ts",
			{ soloRuns } = await import(storage),
			runs = await soloRuns("guest");
		return {
			count: runs.length,
			ticks: runs[0].finishTicks,
			crown: await new Promise<boolean>((resolve, reject) => {
				const open = indexedDB.open("jumpking");
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const db = open.result,
						request = db
							.transaction("profiles")
							.objectStore("profiles")
							.get("guest");
					request.onsuccess = () => {
						const owned = request.result.crownUnlocked === true;
						db.close();
						resolve(owned);
					};
				};
			}),
		};
	});
	expect(result).toEqual({ count: 1, ticks: 16957, crown: true });
	expect(errors).toEqual([]);
});

test("basic ending timeline runs without credits or duplicate callbacks", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (/Texture .* has no frame/.test(message.text()))
			errors.push(message.text());
	});
	await page.goto("/");
	const result = await page.evaluate(async (physics) => {
		const renderer = "/src/game/presentation/createGame.ts";
		const { createGame } = await import(renderer);
		const manifest = await (await fetch("/assets/manifest.json")).json(),
			parent = document.createElement("div");
		document.body.append(parent);
		let ready!: () => void,
			picture!: () => void,
			completions = 0;
		const loaded = new Promise<void>((resolve) => {
				ready = resolve;
			}),
			completed = new Promise<void>((resolve) => {
				picture = resolve;
			});
		const signal = { id: "ending-test", screen: 42 };
		const runtime = {
			advance() {},
			frame: () => ({
				self: {
					id: "self",
					nickname: "Player",
					color: "#ffffff",
					state: physics,
					crowned: true,
				},
				peers: [],
				ending: signal,
			}),
		};
		const failures: string[] = [],
			game = createGame(
				parent,
				manifest,
				runtime,
				ready,
				(error: string) => failures.push(error),
				{
					onEndingComplete: () => {
						completions++;
						picture();
					},
				},
			);
		try {
			await loaded;
			const scene = game.scene.getScene("Tower");
			scene.time.timeScale = 32;
			scene.tweens.timeScale = 32;
			await completed;
			const image = scene.children.getByName("ending-picture");
			const texts = scene.children.list
				.filter((object: { type: string }) =>
					["Text", "BitmapText"].includes(object.type),
				)
				.map((object: { text: string }) => object.text);
			await new Promise<void>((resolve) => setTimeout(resolve, 100));
			return {
				completions,
				picture: image.texture.key,
				camera: scene.cameras.main.scrollY,
				texts,
				failures,
			};
		} finally {
			game.destroy(true);
			parent.remove();
		}
	}, checkpoints.at(-1)!);
	expect(result.completions).toBe(1);
	expect(result.picture).toBe("ending/imagecrown");
	expect(result.camera).toBe(-42 * 360);
	expect(result.texts).toEqual(["Player"]);
	expect(result.failures).toEqual([]);
	expect(errors).toEqual([]);
});
