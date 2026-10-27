import { expect, test } from "@playwright/test";
import checkpoints from "../../common/fixtures/main-babe-checkpoints.json" with {
	type: "json",
};
import route from "../../common/fixtures/main-babe-route.json" with {
	type: "json",
};
import mainMap from "../../common/maps/main-babe.json" with { type: "json" };

test("plays the complete Main Babe input route and renders every reached checkpoint without flight", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const result = await page.goto("/").then(() =>
		page.evaluate(
			async (fixture) => {
				const requiredPath = "/src/required.ts";
				const { required }: typeof import("../src/required") = await import(
					requiredPath
				);
				const renderer = "/src/game/presentation/createGame.ts",
					simulation = "/src/game/simulation/GameSimulation.ts";
				const { createGame } = await import(renderer),
					{ GameSimulation } = await import(simulation);
				const manifest = await (await fetch("/assets/manifest.json")).json(),
					map = fixture.map;
				const state = new GameSimulation(map),
					parent = document.createElement("div");
				parent.style.cssText =
					"position:fixed;inset:0;background:black;z-index:100";
				document.body.append(parent);
				let ready!: () => void;
				const loaded = new Promise<void>((resolve) => {
						ready = resolve;
					}),
					failures: string[] = [],
					visited = new Set<number>();
				const runtime = {
					advance() {},
					frame: () => {
						const saved = state.snapshot();
						return {
							self: {
								id: "self",
								nickname: "Route Player",
								color: "#ffffff",
								state: saved.physics,
								crown: state.adventure.completed ? "GOLD" : "NONE",
								adventure: saved.adventure,
							},
							peers: [],
							world: saved.world,
						};
					},
				};
				const game = createGame(
					parent,
					manifest,
					runtime,
					ready,
					(message: string) => failures.push(message),
				);
				const idle = { left: false, right: false, jump: false },
					step = (input = idle) => {
						state.tick(input);
						visited.add(state.physics.snapshot().screen);
					};
				await loaded;
				for (let index = 0; index < 30; index++) step();
				for (const [index, action] of fixture.route.entries()) {
					if ("walk" in action)
						for (let tick = 0; tick < required(action.ticks); tick++)
							step({
								...idle,
								left: required(action.walk) < 0,
								right: required(action.walk) > 0,
							});
					else {
						step();
						for (let tick = 0; tick < required(action.charge); tick++)
							step({
								left: action.charge === 36 && required(action.direction) < 0,
								right: action.charge === 36 && required(action.direction) > 0,
								jump: true,
							});
						if (action.charge !== 36)
							step({
								left: required(action.direction) < 0,
								right: required(action.direction) > 0,
								jump: false,
							});
						for (let tick = 0; tick < 180; tick++) {
							step();
							if (state.physics.snapshot().grounded && tick > 0) break;
						}
					}
					const pose = state.physics.snapshot();
					const expected = required(fixture.checkpoints[index]);
					for (const key of new Set([
						...Object.keys(pose),
						...Object.keys(expected),
					])) {
						if (
							JSON.stringify(pose[key]) !==
							JSON.stringify(expected[key as keyof typeof expected])
						)
							failures.push(
								`Physics checkpoint ${index}.${key}: ${JSON.stringify(pose[key])} != ${JSON.stringify(expected[key as keyof typeof expected])}`,
							);
					}
					await new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					);
					if (
						game.scene.getScene("Tower").cameras.main.scrollY !==
						-pose.screen * map.screenHeight
					)
						failures.push(`Camera checkpoint ${index}`);
				}
				const pose = state.physics.snapshot();
				return {
					failures,
					visited: [...visited].sort((a, b) => a - b),
					finished: state.finished,
					ticks: pose.ticks,
					jumps: pose.jumps,
					falls: pose.falls,
					flight: pose.freeFlight,
				};
			},
			{ route, checkpoints, map: mainMap },
		),
	);
	expect(result.failures).toEqual([]);
	expect(result.visited).toEqual(
		Array.from({ length: 43 }, (_, index) => index),
	);
	expect(result).toMatchObject({
		finished: true,
		ticks: 16957,
		jumps: 228,
		falls: 0,
		flight: false,
	});
	expect(errors).toEqual([]);
	await page.screenshot({
		path: info.outputPath("main-babe-native-finish.png"),
	});
});
