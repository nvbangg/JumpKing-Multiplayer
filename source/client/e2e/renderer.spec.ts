import { expect, test } from "@playwright/test";
import checkpoints from "../../common/fixtures/main-babe-checkpoints.json" with {
	type: "json",
};
import mainMap from "../../common/maps/main-babe.json" with { type: "json" };
import rules from "../../common/rules.json" with { type: "json" };
import type { GameRuntime } from "../src/game/presentation/types";

test("renderer draws all 43 screens and keeps self above translucent peers", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (/Texture .* has no frame/.test(message.text()))
			errors.push(message.text());
	});
	await page.goto("/");
	await page.exposeFunction("captureCrownScreen", async (name: string) => {
		await page.screenshot({ path: info.outputPath(name) });
	});
	const output = await page.evaluate(
		async ({ states, colors, map }) => {
			const requiredPath = "/src/required.ts";
			const { required }: typeof import("../src/required") = await import(
				requiredPath
			);
			const modulePath = "/src/game/presentation/createGame.ts",
				markerPath = "/src/game/simulation/finishPlatform.ts",
				roomMapsPath = "/src/game/simulation/roomMaps.ts";
			const { createGame } = await import(modulePath),
				{ findFinishPlatform } = await import(markerPath),
				{ ROOM_MAPS, roomMap } = await import(roomMapsPath);
			const adventurePath = "/src/game/simulation/Adventure.ts";
			const { ADVENTURE } = await import(adventurePath);
			const manifest = await (await fetch("/assets/manifest.json")).json();
			const parent = document.createElement("div");
			parent.style.cssText =
				"position:fixed;inset:0;background:black;z-index:100";
			document.body.append(parent);
			let state = required(states[0]);
			let ownColor = 0;
			let frameReads = 0;
			const failures: string[] = [];
			let ready!: () => void;
			const loaded = new Promise<void>((resolve) => {
				ready = resolve;
			});
			const runtime = {
				finishMarker: undefined as GameRuntime["finishMarker"],
				advance() {},
				frame: () => {
					frameReads++;
					return {
						self: {
							id: "self",
							nickname: "You",
							color: colors[ownColor],
							state,
							crown: required(["NONE", "GOLD", "BLACK"][state.screen % 3]),
						},
						world: {
							lastTick: state.ticks,
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
						peers: [
							{
								id: "peer",
								nickname: "Friend",
								color: colors[(ownColor + 1) % colors.length],
								state: { ...state },
								crown: required(["NONE", "GOLD", "BLACK"][state.screen % 3]),
							},
						],
					};
				},
			};
			const game = createGame(
				parent,
				manifest,
				runtime,
				ready,
				(error: string) => failures.push(error),
			);
			await loaded;
			const frames = () =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				);
			const screens: number[] = [];
			try {
				const scene = game.scene.getScene("Tower");
				const readPixels = (key: string) => {
					const image = scene.textures.get(key).getSourceImage(),
						canvas = document.createElement("canvas");
					canvas.width = image.width;
					canvas.height = image.height;
					const context = required(canvas.getContext("2d"));
					context.drawImage(image, 0, 0);
					return context.getImageData(0, 0, canvas.width, canvas.height).data;
				};
				const goldPixels = readPixels(manifest.crown),
					diamondPixels = readPixels(`${manifest.crown}/diamond`);
				if (
					goldPixels.length !== diamondPixels.length ||
					!goldPixels.some((value, i) => value !== diamondPixels[i]) ||
					goldPixels.some(
						(value, i) => i % 4 === 3 && value !== diamondPixels[i],
					)
				)
					failures.push(
						"Diamond crown must change color and preserve transparency",
					);
				for (let i = 0; i < diamondPixels.length; i += 4) {
					if (diamondPixels[i] === goldPixels[i]) continue;
					const [r = 0, g = 0, b = 0] = diamondPixels.slice(i, i + 3);
					if (g < 90 || b < g || b - r < 80) {
						failures.push("Diamond crown must have saturated blue facets");
						break;
					}
				}
				if (scene.children.getByName("room-finish"))
					failures.push("Finish marker outside Room");
				runtime.finishMarker = findFinishPlatform(roomMap(map, 1));
				for (let screen = 0; screen < 43; screen++) {
					const goal = ROOM_MAPS.find(
						(item: { finish: { screen: number } }) =>
							item.finish.screen === screen,
					);
					if (goal)
						runtime.finishMarker = findFinishPlatform(roomMap(map, goal.level));
					state = states.find((candidate) => candidate.screen === screen) || {
						...required(states[0]),
						screen,
						x: 231,
						y: -screen * 360 + 302,
					};
					ownColor = screen % colors.length;
					const scene = game.scene.getScene("Tower");
					const readsBefore = frameReads;
					scene.update(0, 0);
					if (frameReads !== readsBefore + 1)
						failures.push(`Repeated frame snapshot ${screen}`);
					await frames();
					const marker = scene.children.getByName("room-finish");
					if (!!marker !== !!goal) failures.push(`Finish screen ${screen}`);
					if (marker) {
						const bounds = marker.getBounds(),
							camera = scene.cameras.main;
						if (
							marker.text !== "FINISH" ||
							bounds.left < 0 ||
							bounds.right > 480 ||
							bounds.top < camera.scrollY ||
							bounds.bottom > camera.scrollY + 360
						)
							failures.push(`Finish label clipped ${screen}`);
					}
					const sprites = scene.children.list.filter(
						(child: {
							type: string;
							name: string;
							texture?: { key: string };
						}) =>
							child.type === "Sprite" &&
							child.texture?.key === "king/base" &&
							child.name.startsWith("player:"),
					);
					if (
						sprites.length !== 2 ||
						!sprites.some((sprite: { alpha: number }) => sprite.alpha === 1) ||
						!sprites.some((sprite: { alpha: number }) => sprite.alpha === 0.7)
					)
						failures.push(`Avatar opacity ${screen}`);
					const self = sprites.find(
						(sprite: { name: string }) => sprite.name === "player:self",
					);
					const peer = sprites.find(
						(sprite: { name: string }) => sprite.name === "player:peer",
					);
					if (
						self.alpha !== 1 ||
						self.tintTopLeft !==
							Number.parseInt(required(colors[ownColor]).slice(1), 16)
					)
						failures.push(`Local player appearance ${screen}`);
					if (
						peer.alpha !== 0.7 ||
						peer.tintTopLeft !==
							Number.parseInt(
								required(colors[(ownColor + 1) % colors.length]).slice(1),
								16,
							)
					)
						failures.push(`Peer appearance ${screen}`);
					if (self.depth <= peer.depth) failures.push(`Self depth ${screen}`);
					const crowns = scene.children.list.filter(
						(child: { type: string; texture?: { key: string } }) =>
							child.type === "Sprite" &&
							[manifest.crown, `${manifest.crown}/diamond`].includes(
								child.texture?.key,
							),
					);
					if (
						crowns.length !== 2 ||
						!crowns.some(
							(crown: { alpha: number; depth: number }) =>
								crown.alpha === 1 && crown.depth > self.depth,
						) ||
						!crowns.some(
							(crown: { alpha: number; depth: number }) =>
								crown.alpha === 0.7 && crown.depth < self.depth,
						) ||
						crowns.some(
							(crown: {
								visible: boolean;
								tintTopLeft: number;
								texture: { key: string };
							}) =>
								crown.visible !== (screen % 3 !== 0) ||
								crown.tintTopLeft !== 0xffffff ||
								(crown.visible &&
									crown.texture.key !==
										(screen % 3 === 2
											? `${manifest.crown}/diamond`
											: manifest.crown)),
						)
					)
						failures.push(`Crown ${screen}`);
					if (scene.cameras.main.scrollY !== -screen * 360)
						failures.push(`Camera ${screen}`);
					const labels = [
						...parent.querySelectorAll<HTMLElement>(".player-names span"),
					];
					if (labels.length !== 2 || labels.some((label) => label.hidden))
						failures.push(`Names ${screen}`);
					const ownName = parent.querySelector<HTMLElement>(
							'[data-player-id="self"]',
						),
						peerName = parent.querySelector<HTMLElement>(
							'[data-player-id="peer"]',
						);
					if (
						!ownName ||
						!peerName ||
						!getComputedStyle(ownName).fontFamily.includes("Segoe UI") ||
						getComputedStyle(ownName).imageRendering !== "auto" ||
						Number.parseFloat(getComputedStyle(ownName).fontSize) < 11 ||
						scene.children.getByName("nickname:self")
					)
						failures.push(`Name font ${screen}`);
					if (ownName && peerName) {
						const rgb = (hex: string) => {
							const color = Number.parseInt(hex.slice(1), 16);
							return `rgb(${color >> 16}, ${(color >> 8) & 255}, ${color & 255})`;
						};
						if (
							getComputedStyle(ownName).color !==
								rgb(required(colors[ownColor])) ||
							getComputedStyle(peerName).color !==
								rgb(required(colors[(ownColor + 1) % colors.length]))
						)
							failures.push(`Name color ${screen}`);
						const a = ownName.getBoundingClientRect(),
							b = peerName.getBoundingClientRect();
						if (
							a.left < b.right &&
							a.right > b.left &&
							a.top < b.bottom &&
							a.bottom > b.top
						)
							failures.push(`Overlapping names ${screen}`);
					}
					screens.push(screen);
					if (screen === 1 || screen === 2)
						await (
							window as unknown as {
								captureCrownScreen(name: string): Promise<void>;
							}
						).captureCrownScreen(
							`crown-${screen === 1 ? "gold" : "diamond"}.png`,
						);
				}
				return { screens, failures };
			} finally {
				game.destroy(true);
				await frames();
				if (parent.querySelector(".player-names"))
					failures.push("Name layer retained after destroying the game");
				parent.remove();
			}
		},
		{ states: checkpoints, map: mainMap, colors: rules.appearanceColors },
	);
	expect(output.screens).toHaveLength(43);
	expect(output.failures).toEqual([]);
	expect(errors).toEqual([]);
});
