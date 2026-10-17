import { expect, test } from "vitest";
import map from "../../../../common/maps/main-babe.json";
import { findFinishPlatform } from "./finishPlatform";
import { GameSimulation } from "./GameSimulation";
import { ROOM_MAPS, roomMap } from "./roomMaps";
import { PHYSICS } from "./tuning";
import { NEUTRAL_INPUT } from "./types";

test("Room markers use the approved landing platforms", () => {
	expect(
		ROOM_MAPS.map(({ level }) => {
			const marker = findFinishPlatform(roomMap(map, level))!;
			return [level, marker.x, marker.y, marker.width];
		}),
	).toEqual([
		[1, 136, -760, 72],
		[2, 152, -1472, 176],
		[3, 8, -3056, 48],
		[4, 216, -4584, 64],
		[5, 128, -6424, 48],
		[6, 96, -8584, 8],
		[7, 24, -11064, 48],
		[8, 288, -12256, 96],
		[9, 248, -13584, 40],
		[10, 336, -14976, 88],
	]);
});

test("Room 7 does not Finish on the right walkway at the same height", () => {
	const game = new GameSimulation(roomMap(map, 7));
	game.physics.restore({
		...game.physics.snapshot(),
		x: 400 - PHYSICS.bodyWidth / 2,
		y: -11064 - PHYSICS.bodyHeight - 2,
		screen: 31,
		grounded: false,
	});
	for (let tick = 0; tick < PHYSICS.tickRate; tick++) game.tick(NEUTRAL_INPUT);
	expect(game.physics.snapshot().grounded).toBe(true);
	expect(game.physics.progress).toBe(11392);
	expect(game.finished).toBe(false);
});

for (const goal of ROOM_MAPS)
	test(`Room ${goal.level}: landing at the marker satisfies the real Finish rule`, () => {
		const world = roomMap(map, goal.level),
			marker = findFinishPlatform(world)!;
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
		expect(game.finished).toBe(true);
		expect(game.physics.snapshot().grounded).toBe(true);
		expect(game.physics.snapshot().y + PHYSICS.bodyHeight).toBe(marker.y);
	});
