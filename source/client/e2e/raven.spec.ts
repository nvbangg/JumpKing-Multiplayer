import { expect, test } from "@playwright/test";

test("raven renders perching and flight, and resumes its saved position", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (/Texture .* has no frame/.test(message.text()))
			errors.push(message.text());
	});
	await page.goto("/");
	const result = await page.evaluate(async () => {
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
			screen: 2,
			x: 200,
			y: 88 - 720,
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
				bird = scene.children.getByName("raven");
			scene.update(0, 0);
			const idle = {
				visible: bird.visible,
				frame: bird.frame.name,
				x: bird.x,
				y: bird.y,
			};
			pose = { ...pose, x: 25, y: 88 - 720 - 13 };
			for (let tick = 0; tick < 10; tick++)
				gameState.adventure.tick(pose, {
					left: false,
					right: false,
					jump: false,
				});
			scene.update(0, 0);
			const flight = {
				visible: bird.visible,
				frame: bird.frame.name,
				x: bird.x,
				y: bird.y,
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
				hidden: !bird.visible,
				index: gameState.adventure.snapshot().raven.index,
				resumed:
					JSON.stringify(restored.adventure.snapshot()) ===
					JSON.stringify(gameState.adventure.snapshot()),
				failures,
			};
		} finally {
			game.destroy(true);
			parent.remove();
		}
	});
	expect(result.idle).toEqual({
		visible: true,
		frame: "raven-idle:0",
		x: 34,
		y: 88 - 720,
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
