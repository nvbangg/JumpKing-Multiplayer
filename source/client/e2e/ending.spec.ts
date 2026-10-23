import { expect, test } from "@playwright/test";
import checkpoints from "../../common/fixtures/main-babe-checkpoints.json" with {
	type: "json",
};
import { required } from "../src/required";

for (const ravenDone of [false, true])
	test(`ending raven=${ravenDone} runs without credits or duplicate callbacks`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (/Texture .* has no frame/.test(message.text()))
				errors.push(message.text());
		});
		await page.goto("/");
		const result = await page.evaluate(
			async ({ physics, ravenDone }) => {
				const renderer = "/src/game/presentation/createGame.ts";
				const { createGame } = await import(renderer);
				const adventurePath = "/src/game/simulation/Adventure.ts";
				const { ADVENTURE } = await import(adventurePath);
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
				const signal = { id: "ending-test", screen: 42, ravenDone };
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
						world: {
							lastTick: physics.ticks,
							registeredScreens: [],
							weatherWind: 0,
							walls: Object.fromEntries(
								manifest.walls.map((wall: { id: string }) => [
									wall.id,
									{
										touching: false,
										canPlay: true,
										fadeTicks: ADVENTURE.tuning.wallFadeTicks,
									},
								]),
							),
						},
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
					const carrier = scene.children.list
						.flatMap(
							(object: { list?: { name: string }[] }) => object.list || [],
						)
						.find(
							(object: { name: string }) =>
								object.name === "ending-crown-carrier",
						);
					const carrierTexture = carrier?.list[0]?.texture.key;
					if (
						carrierTexture !==
						(ravenDone ? "props/textures/raven/raven_crown" : "king/base")
					)
						failures.push("Wrong crown carrier texture");
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
			},
			{ physics: required(checkpoints.at(-1)), ravenDone },
		);
		expect(result.completions).toBe(1);
		expect(result.picture).toBe("ending/imagecrown");
		expect(result.camera).toBe(-42 * 360);
		expect(result.texts).toEqual(["Player"]);
		expect(result.failures).toEqual([]);
		expect(errors).toEqual([]);
	});
