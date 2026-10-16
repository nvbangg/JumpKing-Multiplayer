import { expect, test } from "vitest";
import map from "../../../../common/maps/main-babe.json";
import { GameSimulation } from "../simulation/GameSimulation";
import { ROOM_MAPS, roomMap } from "../simulation/roomMaps";
import { PHYSICS } from "../simulation/tuning";
import { NEUTRAL_INPUT } from "../simulation/types";
import { finishMarker } from "./finishMarker";

for (const goal of ROOM_MAPS)
	test(`Room ${goal.level}: landing at the marker satisfies the real Finish rule`, () => {
		const world = roomMap(map, goal.level),
			marker = finishMarker(world)!;
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
