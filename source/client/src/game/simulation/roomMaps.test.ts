import { expect, test } from "vitest";
import checkpoints from "../../../../common/fixtures/main-babe-checkpoints.json";
import route from "../../../../common/fixtures/main-babe-route.json";
import map from "../../../../common/maps/main-babe.json";
import { GameSimulation } from "./GameSimulation";
import { ROOM_MAPS, roomMap } from "./roomMaps";
import { NEUTRAL_INPUT, type PlayerInput } from "./types";

for (const goal of ROOM_MAPS)
	test(`Room ${goal.level}: reachable prefix and full-map reward boundary`, () => {
		const world = roomMap(map, goal.level),
			game = new GameSimulation(world);
		expect(world.screens).toBe(map.screens);
		expect(world.spawn).toBe(map.spawn);
		const step = (input: PlayerInput = NEUTRAL_INPUT) => {
			if (!game.finished) game.tick(input);
		};
		for (let i = 0; i < 30; i++) step();
		for (const action of route) {
			if ("walk" in action) {
				for (let i = 0; i < action.ticks!; i++)
					step({
						left: action.walk! < 0,
						right: action.walk! > 0,
						jump: false,
					});
			} else {
				step();
				for (let i = 0; i < action.charge!; i++)
					step({
						left: action.charge === 36 && action.direction! < 0,
						right: action.charge === 36 && action.direction! > 0,
						jump: true,
					});
				if (action.charge !== 36)
					step({
						left: action.direction! < 0,
						right: action.direction! > 0,
						jump: false,
					});
				for (let i = 0; i < 180; i++) {
					step();
					if (game.physics.snapshot().grounded && i > 0) break;
				}
			}
			if (game.finished) break;
		}
		const state = game.physics.snapshot();
		expect(game.finished).toBe(true);
		expect(state.screen).toBe(goal.finish.screen);
		expect(state.falls).toBe(0);
		expect(state.freeFlight).toBe(false);
		expect(game.adventure.completed).toBe(goal.level === 10);
		const landing = checkpoints.find(
			(point) =>
				point.screen === goal.finish.screen &&
				point.grounded &&
				map.progressOriginY - point.y - 26 >= goal.finish.minProgress &&
				point.x + 9 >= goal.finish.minCenterX,
		);
		expect(landing).toBeDefined();
		expect(state.ticks).toBeLessThanOrEqual(landing!.ticks);
		const airborne = { ...state, grounded: false };
		game.physics.restore(airborne);
		expect(game.finished).toBe(false);
	});

test("invalid Room lengths fail closed", () => {
	for (const level of [0, 11, 1.5, NaN])
		expect(() => roomMap(map, level)).toThrow();
});
