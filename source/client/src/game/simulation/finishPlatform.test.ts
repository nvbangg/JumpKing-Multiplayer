import { expect, test } from "vitest";
import map from "../../../../common/maps/main-babe.json";
import { required } from "../../required";
import { findFinishPlatform } from "./finishPlatform";
import { GameSimulation } from "./GameSimulation";
import { ROOM_MAPS, roomMap } from "./roomMaps";
import { PHYSICS } from "./tuning";
import { NEUTRAL_INPUT } from "./types";

test("Room markers use the approved landing platforms", () => {
	expect(
		ROOM_MAPS.map(({ level }) => {
			const marker = required(findFinishPlatform(roomMap(map, level)));
			return [level, marker.x, marker.y, marker.width];
		}),
	).toEqual([
		[1, 136, -760, 72],
		[2, 152, -1472, 176],
		[3, 152, -3136, 48],
		[4, 208, -8688, 80],
		[5, 200, -8808, 88],
		[6, 72, -11176, 88],
		[7, 416, -12632, 56],
		[8, 304, -13768, 32],
		[9, 328, -14232, 24],
	]);
});

test("Room 6 does not Finish on the right platform at the same height", () => {
	const game = new GameSimulation(roomMap(map, 6));
	game.physics.restore({
		...game.physics.snapshot(),
		x: 400 - PHYSICS.bodyWidth / 2,
		y: -11176 - PHYSICS.bodyHeight - 2,
		screen: 32,
		grounded: false,
	});
	for (let tick = 0; tick < PHYSICS.tickRate; tick++) game.tick(NEUTRAL_INPUT);
	expect(game.physics.snapshot().grounded).toBe(true);
	expect(game.physics.progress).toBe(
		required(game.physics.map.finish.minProgress),
	);
	expect(game.finished).toBe(false);
});

for (const goal of ROOM_MAPS)
	test(`Room ${goal.level}: landing at the marker satisfies the real Finish rule`, () => {
		const world = roomMap(map, goal.level),
			marker = required(findFinishPlatform(world));
		expect(marker).toBeDefined();
		expect(marker.screen).toBe(goal.finish.screen);
		const game = new GameSimulation(world);
		game.physics.restore({
			...game.physics.snapshot(),
			x: marker.x + (marker.width - PHYSICS.bodyWidth) / 2,
			y: marker.y - PHYSICS.bodyHeight - 2,
			screen: marker.screen,
			grounded: false,
		});
		expect(game.finished).toBe(false);
		for (let tick = 0; tick < PHYSICS.tickRate && !game.finished; tick++)
			game.tick(NEUTRAL_INPUT);
		expect(
			game.finished,
			JSON.stringify({
				state: game.physics.snapshot(),
				progress: game.physics.progress,
				finish: world.finish,
				marker,
			}),
		).toBe(true);
		expect(game.physics.snapshot().grounded).toBe(true);
		expect(game.physics.snapshot().y + PHYSICS.bodyHeight).toBe(marker.y);
	});
