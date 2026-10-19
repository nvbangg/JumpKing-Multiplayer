import { expect, test } from "@playwright/test";

for (const bird of [
	{ id: "raven", screen: 2, x: 34, y: 88 },
	{ id: "whiteRaven", screen: 0, x: 210, y: 31 },
] as const)
	test(`${bird.id} renders perching and flight, and resumes its saved position`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (/Texture .* has no frame/.test(message.text()))
				errors.push(message.text());
		});
		await page.goto("/");
		const result = await page.evaluate(async (bird) => {
			const renderPath = "/src/game/presentation/createGame.ts",
				simulationPath = "/src/game/simulation/GameSimulation.ts";
			const { createGame } = await import(renderPath),
				{ GameSimulation } = await import(simulationPath);
			const manifest = await (await fetch("/assets/manifest.json")).json(),
				map = await (await fetch("/shared/maps/main-babe.json")).json();
			const gameState = new GameSimulation(map),
				parent = document.createElement("div");
			document.body.append(parent);
			let pose = {
				...gameState.physics.snapshot(),
				screen: bird.screen,
				x: bird.x + 100,
				y: bird.y - bird.screen * 360,
			};
			let ready!: () => void;
			const loaded = new Promise<void>((resolve) => {
				ready = resolve;
			});
			const failures: string[] = [];
			const game = createGame(
				parent,
				manifest,
				{
					advance() {},
					frame: () => ({
						self: {
							id: "self",
							nickname: "Player",
							color: "#ffffff",
							state: pose,
							crowned: false,
							adventure: gameState.adventure.snapshot(),
						},
						peers: [],
					}),
				},
				ready,
				(error: string) => failures.push(error),
			);
			try {
				await loaded;
				const scene = game.scene.getScene("Tower"),
					visual = scene.children.getByName(bird.id);
				scene.update(0, 0);
				const idle = {
					visible: visual.visible,
					frame: visual.frame.name,
					x: visual.x,
					y: visual.y,
				};
				pose = { ...pose, x: bird.x - 9, y: bird.y - bird.screen * 360 - 13 };
				for (let tick = 0; tick < 10; tick++)
					gameState.adventure.tick(pose, {
						left: false,
						right: false,
						jump: false,
					});
				scene.update(0, 0);
				const flight = {
					visible: visual.visible,
					frame: visual.frame.name,
					x: visual.x,
					y: visual.y,
				};
				const saved = gameState.adventure.snapshot();
				const restored = new GameSimulation(map);
				restored.adventure.restore(saved);
				for (let tick = 0; tick < 100; tick++) {
					gameState.adventure.tick(pose, {
						left: false,
						right: false,
						jump: false,
					});
					restored.adventure.tick(pose, {
						left: false,
						right: false,
						jump: false,
					});
				}
				scene.update(0, 0);
				return {
					idle,
					flight,
					hidden: !visual.visible,
					index: gameState.adventure.snapshot()[bird.id].index,
					resumed:
						JSON.stringify(restored.adventure.snapshot()) ===
						JSON.stringify(gameState.adventure.snapshot()),
					failures,
				};
			} finally {
				game.destroy(true);
				parent.remove();
			}
		}, bird);
		expect(result.idle).toEqual({
			visible: true,
			frame: "raven-idle:0",
			x: bird.x,
			y: bird.y - bird.screen * 360,
		});
		expect(result.flight.visible).toBe(true);
		expect(result.flight.frame).toMatch(/^raven-fly:/);
		expect(result.flight.y).toBeLessThan(result.idle.y);
		expect(result.hidden).toBe(true);
		expect(result.index).toBe(1);
		expect(result.resumed).toBe(true);
		expect(result.failures).toEqual([]);
		expect(errors).toEqual([]);
	});
