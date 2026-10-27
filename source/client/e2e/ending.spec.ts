import { expect, test } from "@playwright/test";
import checkpoints from "../../common/fixtures/main-babe-checkpoints.json" with {
	type: "json",
};
import { required } from "../src/required";

for (const { ravenDone, crown } of [
	{ ravenDone: false, crown: "GOLD" },
	{ ravenDone: true, crown: "BLACK" },
	{ ravenDone: false, crown: "BLACK" },
] as const)
	test(`ending raven=${ravenDone}, crown=${crown} runs without credits or duplicate callbacks`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (/Texture .* has no frame/.test(message.text()))
				errors.push(message.text());
		});
		await page.goto("/");
		await page.exposeFunction(
			"captureCrownEnding",
			async (name = "ending-crown.png") => {
				await page.screenshot({ path: info.outputPath(name) });
			},
		);
		const result = await page.evaluate(
			async ({ physics, ravenDone, crown }) => {
				const renderer = "/src/game/presentation/createGame.ts";
				const { createGame } = await import(renderer);
				const adventurePath = "/src/game/simulation/Adventure.ts";
				const { ADVENTURE } = await import(adventurePath);
				const manifest = await (await fetch("/assets/manifest.json")).json(),
					parent = document.createElement("div");
				parent.style.cssText =
					"position:fixed;inset:0;background:black;z-index:100";
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
				const signal = { id: "ending-test", screen: 42, ravenDone, crown };
				const runtime = {
					advance() {},
					frame: () => ({
						self: {
							id: "self",
							nickname: "Player",
							color: "#ffffff",
							state: physics,
							crown,
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
					const wornTexture =
						crown === "BLACK" ? `${manifest.crown}/diamond` : manifest.crown;
					type ObjectTree = {
						texture?: { key: string };
						frame?: { name: string };
						list?: ObjectTree[];
					};
					const descendants = (objects: ObjectTree[]): ObjectTree[] =>
						objects.flatMap((object) => [
							object,
							...descendants(object.list ?? []),
						]);
					const normalTextures = new Set<string>();
					let wornCapture: Promise<void> | undefined;
					const wearsCrown = (objects: ObjectTree[]): boolean =>
						objects.some(
							(object) =>
								object.texture?.key === wornTexture ||
								(object.list !== undefined && wearsCrown(object.list)),
						);
					let woreCrown = false;
					scene.events.on("postupdate", () => {
						const normal = descendants(scene.children.list).filter((object) =>
							object.frame?.name.startsWith("ending:normal."),
						);
						for (const object of normal)
							if (object.texture) normalTextures.add(object.texture.key);
						if (
							!wornCapture &&
							normal.some(
								(object) => object.frame?.name === "ending:normal.idle_right",
							)
						) {
							scene.time.timeScale = scene.tweens.timeScale = 0;
							wornCapture = (
								window as unknown as {
									captureCrownEnding(name: string): Promise<void>;
								}
							)
								.captureCrownEnding("ending-worn-crown.png")
								.finally(() => {
									scene.time.timeScale = scene.tweens.timeScale = 32;
								});
						}
						woreCrown ||= wearsCrown(
							scene.children.list.filter(
								(object: ObjectTree) => object.list !== undefined,
							),
						);
					});
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
						(ravenDone
							? "props/textures/raven/raven_crown/diamond"
							: crown === "BLACK"
								? "king/base/diamond"
								: "king/base")
					)
						failures.push("Wrong crown carrier texture");
					scene.time.timeScale = 32;
					scene.tweens.timeScale = 32;
					await completed;
					await wornCapture;
					await new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					);
					await (
						window as unknown as { captureCrownEnding(): Promise<void> }
					).captureCrownEnding();
					const image = scene.children.getByName("ending-picture");
					const texts = scene.children.list
						.filter((object: { type: string }) =>
							["Text", "BitmapText"].includes(object.type),
						)
						.map((object: { text: string }) => object.text);
					await new Promise<void>((resolve) => setTimeout(resolve, 100));
					return {
						completions,
						woreCrown,
						normalTextures: [...normalTextures],
						picture: image.texture.key,
						camera: scene.cameras.main.scrollY,
						texts,
						namesHidden:
							parent.querySelector<HTMLElement>(".player-names")?.hidden,
						failures,
					};
				} finally {
					game.destroy(true);
					parent.remove();
				}
			},
			{ physics: required(checkpoints.at(-1)), ravenDone, crown },
		);
		expect(result.completions).toBe(1);
		expect(result.woreCrown).toBe(true);
		expect(result.normalTextures).toEqual([
			crown === "BLACK" ? "king/base/diamond" : "king/base",
			crown === "BLACK" ? "king/crown/diamond" : "king/crown",
		]);
		expect(result.picture).toBe(
			crown === "BLACK" ? "ending/imagecrown/diamond" : "ending/imagecrown",
		);
		expect(result.camera).toBe(-42 * 360);
		expect(result.texts).toEqual([]);
		expect(result.namesHidden).toBe(true);
		expect(result.failures).toEqual([]);
		expect(errors).toEqual([]);
	});
