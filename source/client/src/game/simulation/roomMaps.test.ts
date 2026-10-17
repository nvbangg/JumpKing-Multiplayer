import { expect, test } from "vitest";
import checkpoints from "../../../../common/fixtures/main-babe-checkpoints.json";
import route from "../../../../common/fixtures/main-babe-route.json";
import map from "../../../../common/maps/main-babe.json";
import manifest from "../../../public/assets/manifest.json";
import { GameSimulation } from "./GameSimulation";
import { ROOM_MAPS, roomMap } from "./roomMaps";
import { PHYSICS } from "./tuning";
import { NEUTRAL_INPUT, type PlayerInput } from "./types";

const floorEnds = [208, 328, 56, 280, 176, 104, 72, 384, 288];

test("Room maps keep the ten approved Finish boundaries", () => {
	expect(
		ROOM_MAPS.map(({ level, finish }) => [
			level,
			finish.screen,
			finish.minCenterX,
			finish.minProgress,
			finish.requiresGrounded,
		]),
	).toEqual([
		[1, 3, 136, 1088, true],
		[2, 5, 152, 1800, true],
		[3, 9, 8, 3384, true],
		[4, 13, 216, 4912, true],
		[5, 18, 128, 6752, true],
		[6, 24, 96, 8912, true],
		[7, 31, 24, 11392, true],
		[8, 35, 288, 12584, true],
		[9, 38, 248, 13912, true],
		[10, 42, 336, 0, true],
	]);
});

test("Room labels distinguish the forest sections and retain later region names", () => {
	expect(ROOM_MAPS.slice(0, 2).map((goal) => goal.name)).toEqual([
		"Green Woods",
		"Red Tree",
	]);
	for (const goal of ROOM_MAPS.slice(2, -1))
		expect(manifest.screens[goal.finish.screen]!.location).toBe(
			goal.name.toUpperCase(),
		);
});

for (const goal of ROOM_MAPS.slice(0, -1))
	test(`Room ${goal.level}: Finish requires landing on the selected floor`, () => {
		const world = roomMap(map, goal.level),
			game = new GameSimulation(world),
			state = {
				...game.physics.snapshot(),
				x: goal.finish.minCenterX - PHYSICS.bodyWidth / 2,
				y: world.progressOriginY - goal.finish.minProgress - PHYSICS.bodyHeight,
				screen: goal.finish.screen,
				grounded: true,
			};
		game.physics.restore(state);
		expect(game.finished).toBe(true);
		game.physics.restore({ ...state, x: state.x - 0.25 });
		expect(game.finished).toBe(false);
		game.physics.restore({ ...state, y: state.y + 0.25 });
		expect(game.finished).toBe(false);
		game.physics.restore({ ...state, y: state.y - 0.25 });
		expect(game.finished).toBe(false);
		game.physics.restore({ ...state, grounded: false });
		expect(game.finished).toBe(false);
		game.physics.restore({ ...state, screen: state.screen - 1 });
		expect(game.finished).toBe(false);
		const floorEnd = floorEnds[goal.level - 1]!;
		game.physics.restore({ ...state, x: floorEnd });
		expect(game.finished).toBe(false);
		// Giữ biên phải của đoạn Finish; nền không giới hạn chấp nhận thân còn chạm mép.
		game.physics.restore({
			...state,
			x:
				goal.finish.maxCenterX === undefined
					? floorEnd - 0.25
					: goal.finish.maxCenterX - PHYSICS.bodyWidth / 2,
		});
		expect(game.finished).toBe(true);
	});

test("a higher grounded platform in the Finish screen does not end a short Room", () => {
	const game = new GameSimulation(roomMap(map, 1));
	const point = checkpoints.find((checkpoint) => checkpoint.ticks === 1182)!;
	game.physics.restore({ ...point, codecVersion: 1 });
	expect(point.screen).toBe(game.map.finish.screen);
	expect(point.grounded).toBe(true);
	expect(point.x + PHYSICS.bodyWidth / 2).toBeGreaterThanOrEqual(
		game.map.finish.minCenterX,
	);
	expect(game.physics.progress).toBeGreaterThan(game.map.finish.minProgress!);
	expect(game.finished).toBe(false);
});

test("Room 7 requires reaching the left brazier rather than the rest of the walkway", () => {
	const game = new GameSimulation(roomMap(map, 7));
	for (const [x, finished] of [
		[60, true],
		[64, false],
		[152, false],
	] as const) {
		game.physics.restore({
			...game.physics.snapshot(),
			x,
			y: -11064 - PHYSICS.bodyHeight,
			screen: 31,
			grounded: true,
		});
		expect(game.finished).toBe(finished);
	}
});

test("Room 10 keeps the native Solo and Community Finish", () => {
	expect(map.finish).toEqual({
		screen: 42,
		minCenterX: 336,
		requiresGrounded: true,
	});
	const original = new GameSimulation(map),
		room = new GameSimulation(roomMap(map, 10));
	for (const [ticks, finished] of [
		[16861, false],
		[16957, true],
	] as const) {
		const point = checkpoints.find((checkpoint) => checkpoint.ticks === ticks)!;
		original.physics.restore({ ...point, codecVersion: 1 });
		room.physics.restore({ ...point, codecVersion: 1 });
		expect(original.finished).toBe(finished);
		expect(room.finished).toBe(finished);
	}
});

for (const goal of ROOM_MAPS)
	test(`Room ${goal.level}: reachable prefix and full-map reward boundary`, () => {
		const world = roomMap(map, goal.level),
			game = new GameSimulation(world);
		expect(world.screens).toBe(map.screens);
		expect(world.spawn).toBe(map.spawn);
		const step = (input: PlayerInput = NEUTRAL_INPUT) => {
			if (!game.finished) game.tick(input);
		};
		const repeat = (ticks: number, input: PlayerInput = NEUTRAL_INPUT) => {
			for (let i = 0; i < ticks; i++) step(input);
		};
		repeat(30);
		for (const [index, action] of route.entries()) {
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
			// Bước tới tâm cột cờ sau cú nhảy cuối của đoạn leo.
			if (goal.level === 6 && game.physics.snapshot().ticks === 9469)
				repeat(4, { ...NEUTRAL_INPUT, right: true });
			if (game.finished) break;
			expect(game.physics.snapshot(), `route checkpoint ${index}`).toEqual(
				checkpoints[index],
			);
		}
		const state = game.physics.snapshot();
		expect(game.finished).toBe(true);
		expect(state.screen).toBe(goal.finish.screen);
		expect(state.falls).toBe(0);
		expect(state.freeFlight).toBe(false);
		expect(game.adventure.completed).toBe(goal.level === 10);
		if (goal.level < 10) {
			expect(game.physics.progress).toBe(goal.finish.minProgress);
			expect(state.x).toBeLessThan(floorEnds[goal.level - 1]!);
		}
		expect(state.x + PHYSICS.bodyWidth).toBeGreaterThan(goal.finish.minCenterX);
		expect(state.ticks).toBe(
			[1021, 1815, 4078, 5524, 7538, 9473, 12908, 14058, 15426, 16957][
				goal.level - 1
			],
		);
		const airborne = { ...state, grounded: false };
		game.physics.restore(airborne);
		expect(game.finished).toBe(false);
	});

test("invalid Room lengths fail closed", () => {
	for (const level of [0, 11, 1.5, NaN])
		expect(() => roomMap(map, level)).toThrow();
});
