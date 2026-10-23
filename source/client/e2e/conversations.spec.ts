import { expect, test } from "@playwright/test";
import mainMap from "../../common/maps/main-babe.json" with { type: "json" };

test("native bitmap NPC and readable dialogue render while gameplay continues", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (/Texture .* has no frame|Invalid Bitmap/.test(message.text()))
			errors.push(message.text());
	});
	await page.goto("/");
	const result = await page.evaluate(async (map) => {
		const renderer = "/src/game/presentation/createGame.ts",
			simulation = "/src/game/simulation/GameSimulation.ts";
		const { createGame } = await import(renderer),
			{ GameSimulation } = await import(simulation);
		const manifest = await (await fetch("/assets/manifest.json")).json();
		const gameState = new GameSimulation(map),
			parent = document.createElement("div");
		parent.style.cssText =
			"position:fixed;inset:0;background:black;z-index:100";
		document.body.append(parent);
		const runtime = {
			advance() {},
			frame: () => {
				const s = gameState.snapshot();
				return {
					self: {
						id: "self",
						nickname: "Player",
						color: "#ffffff",
						state: s.physics,
						crowned: gameState.adventure.completed,
						adventure: s.adventure,
					},
					peers: [],
					world: s.world,
				};
			},
		};
		let ready!: () => void;
		const loaded = new Promise<void>((resolve) => {
			ready = resolve;
		});
		const failures: string[] = [],
			game = createGame(parent, manifest, runtime, ready, (message: string) =>
				failures.push(message),
			);
		const frames = () =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			);
		try {
			await loaded;
			for (let i = 0; i < 120; i++)
				gameState.tick({ left: false, right: false, jump: false });
			await frames();
			const scene = game.scene.getScene("Tower"),
				npc = scene.children.getByName("dialogue:old_man");
			const first = { text: npc?.text, visible: npc?.visible, type: npc?.type };
			for (let i = 0; i < 36; i++)
				gameState.tick({ left: false, right: true, jump: true });
			await frames();
			const physics = gameState.physics.snapshot();
			const bookPlayer = {
				...physics,
				x: 20,
				y: 305 - 21 * map.screenHeight,
				screen: 21,
			};
			gameState.physics.restore(bookPlayer);
			for (let i = 0; i < 60; i++)
				gameState.adventure.tick(bookPlayer, {
					left: false,
					right: false,
					jump: false,
				});
			await frames();
			const readable = scene.children.getByName("dialogue:22_diary");
			return {
				first,
				jumps: physics.jumps,
				ticks: physics.ticks,
				book: {
					text: readable?.text,
					visible: readable?.visible,
					type: readable?.type,
				},
				oldHidden: !npc.visible,
				failures,
			};
		} finally {
			game.destroy(true);
			parent.remove();
		}
	}, mainMap);
	expect(result.first).toMatchObject({ visible: true, type: "BitmapText" });
	expect(result.first.text).toContain("You");
	expect(result.jumps).toBe(1);
	expect(result.ticks).toBe(156);
	expect(result.book).toMatchObject({
		visible: true,
		type: "BitmapText",
		text: "Day 187",
	});
	expect(result.oldHidden).toBe(true);
	expect(result.failures).toEqual([]);
	expect(errors).toEqual([]);
});
