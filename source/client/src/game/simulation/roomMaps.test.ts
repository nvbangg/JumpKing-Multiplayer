import { expect, test } from "vitest";
import adventure from "../../../../common/adventure.json";
import checkpoints from "../../../../common/fixtures/main-babe-checkpoints.json";
import route from "../../../../common/fixtures/main-babe-route.json";
import map from "../../../../common/maps/main-babe.json";
import manifest from "../../../public/assets/manifest.json";
import { required } from "../../required";
import { findFinishPlatform } from "./finishPlatform";
import { GameSimulation } from "./GameSimulation";
import { ROOM_MAPS, roomMap } from "./roomMaps";
import { PHYSICS } from "./tuning";
import { NEUTRAL_INPUT, type PlayerInput } from "./types";

const floorEnds = [208, 328, 56, 280, 176, 280, 72, 384, 288];

test("region boundaries match the manifest and Colossal Drain starts on screen six", () => {
	const starts = manifest.screens.flatMap((screen, index) =>
		screen.location !== manifest.screens[index - 1]?.location ? [index] : [],
	);
	expect(starts).toEqual(adventure.regionStarts);
	expect(manifest.screens[4]?.location).toBe("REDCROWN WOODS");
	expect(manifest.screens[5]?.location).toBe("COLOSSAL DRAIN");
});

test("Room maps keep the nine approved Finish boundaries", () => {
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
		[3, 9, 152, 3464, true],
		[4, 25, 208, 9016, true],
		[5, 25, 200, 9136, true],
		[6, 32, 72, 11504, true],
		[7, 36, 416, 12960, true],
		[8, 39, 304, 14096, true],
		[9, 40, 328, 14560, true],
	]);
});

test("Room labels follow the asset regions and requested early split", () => {
	expect(ROOM_MAPS.map((goal) => goal.name)).toEqual([
		"Green Woods",
		"Red Tree",
		"Colossal Drain",
		"Bargainburg",
		"Windswept Bluff",
		"Stormwall Pass",
		"Chapel Perilous",
		"Blue Ruin",
		"The Tower",
	]);
	expect(manifest.screens[26]?.location).toBe("STORMWALL PASS");
	expect(manifest.screens[32]?.location).toBe("CHAPEL PERILOUS");
	expect(manifest.screens[36]?.location).toBe("BLUE RUIN");
	expect(manifest.screens[39]?.location).toBe("THE TOWER");
});

test("each Room map after the first starts on the previous map's Finish platform", () => {
	for (const goal of ROOM_MAPS.slice(1)) {
		const previous = required(ROOM_MAPS[goal.level - 2]),
			platform = required(
				findFinishPlatform({ ...map, finish: previous.finish }),
			),
			spawn = {
				x: platform.x + (platform.width - PHYSICS.bodyWidth) / 2,
				y: platform.y - PHYSICS.bodyHeight,
			},
			stage = roomMap(map, goal.level),
			game = new GameSimulation(stage);
		expect(stage.spawn).toEqual(spawn);
		expect(stage.roomBottomY).toBe(spawn.y);
		expect(stage.progressOriginY).toBe(spawn.y + PHYSICS.bodyHeight);
		expect(stage.finish.minProgress).toBe(
			goal.finish.minProgress === 0
				? 0
				: goal.finish.minProgress + stage.progressOriginY - map.progressOriginY,
		);
		expect(game.physics.progress).toBe(0);
		expect(game.physics.snapshot().grounded).toBe(true);
		game.tick(NEUTRAL_INPUT);
		const grounded = game.physics.snapshot();
		expect(grounded.x).toBeGreaterThanOrEqual(platform.x);
		expect(grounded.x + PHYSICS.bodyWidth).toBeLessThanOrEqual(
			platform.x + platform.width,
		);
		expect(grounded.y).toBe(spawn.y);
		expect(grounded.grounded).toBe(true);
	}

	expect(roomMap(map, 1).roomBottomY).toBeUndefined();
	const lastMap = roomMap(map, 9);
	const lastGoal = required(ROOM_MAPS[8]);
	expect(lastMap.spawn).toEqual({ x: 311, y: -13794 });
	expect(lastMap.progressOriginY).toBe(-13768);
	expect(lastMap.roomBottomY).toBe(lastMap.spawn.y);
	expect(lastMap.finish).toEqual({ ...lastGoal.finish, minProgress: 464 });
	expect(
		ROOM_MAPS.map(({ level }) => [level, roomMap(map, level).spawn]),
	).toEqual([
		[1, { x: 231, y: 302 }],
		[2, { x: 163, y: -786 }],
		[3, { x: 231, y: -1498 }],
		[4, { x: 167, y: -3162 }],
		[5, { x: 239, y: -8714 }],
		[6, { x: 235, y: -8834 }],
		[7, { x: 107, y: -11202 }],
		[8, { x: 435, y: -12658 }],
		[9, { x: 311, y: -13794 }],
	]);
});

test("falling below a selected map returns to its start and counts once", () => {
	for (const goal of ROOM_MAPS.slice(1)) {
		const stage = roomMap(map, goal.level),
			game = new GameSimulation(stage),
			initial = game.physics.snapshot(),
			y = required(stage.roomBottomY) + 100;
		game.physics.restore({
			...initial,
			y,
			screen: Math.max(
				0,
				Math.min(
					stage.screens.length - 1,
					-Math.floor((y + PHYSICS.bodyHeight / 2) / stage.screenHeight),
				),
			),
			grounded: false,
			vy: 0,
		});
		expect(game.tick(NEUTRAL_INPUT).movement, `map ${goal.level}`).toContain(
			"SPLAT",
		);
		expect(game.physics.snapshot()).toMatchObject({
			x: stage.spawn.x,
			y: stage.spawn.y,
			falls: initial.falls + 1,
		});
	}
});

for (const goal of ROOM_MAPS.filter(({ level }) => [1, 2].includes(level)))
	test(`Room ${goal.level}: Finish requires landing on the selected floor`, () => {
		const world = { ...map, finish: goal.finish },
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
		const floorEnd = required(floorEnds[goal.level - 1]);
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
	const point = required(
		checkpoints.find((checkpoint) => checkpoint.ticks === 1182),
	);
	game.physics.restore({ ...point, codecVersion: 1 });
	expect(point.screen).toBe(game.map.finish.screen);
	expect(point.grounded).toBe(true);
	expect(point.x + PHYSICS.bodyWidth / 2).toBeGreaterThanOrEqual(
		game.map.finish.minCenterX,
	);
	expect(game.physics.progress).toBeGreaterThan(
		required(game.map.finish.minProgress),
	);
	expect(game.finished).toBe(false);
});

test("Room 6 requires reaching the left brazier rather than the rest of the walkway", () => {
	const game = new GameSimulation(roomMap(map, 6));
	for (const [x, finished] of [
		[63, true],
		[152, false],
	] as const) {
		game.physics.restore({
			...game.physics.snapshot(),
			x,
			y: -11176 - PHYSICS.bodyHeight,
			screen: 32,
			grounded: true,
		});
		expect(game.finished).toBe(finished);
	}
});

test("Room 9 finishes at The Tower while Community keeps the Main Babe finish", () => {
	const room = new GameSimulation(roomMap(map, 9)),
		marker = required(findFinishPlatform(room.map)),
		state = {
			...room.physics.snapshot(),
			x: marker.x + (marker.width - PHYSICS.bodyWidth) / 2,
			y: marker.y - PHYSICS.bodyHeight,
			screen: marker.screen,
			grounded: true,
		};
	room.physics.restore(state);
	expect(room.finished).toBe(true);
	expect(room.adventure.completed).toBe(false);
	const community = new GameSimulation(map);
	community.physics.restore(state);
	expect(community.finished).toBe(false);
});

for (const goal of ROOM_MAPS.filter(({ level }) => [1, 2, 9].includes(level)))
	test(`Room ${goal.level}: Finish marker is reachable from the native spawn`, () => {
		const world = { ...map, finish: goal.finish },
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
				for (let i = 0; i < required(action.ticks); i++)
					step({
						left: required(action.walk) < 0,
						right: required(action.walk) > 0,
						jump: false,
					});
			} else {
				step();
				for (let i = 0; i < required(action.charge); i++)
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
				for (let i = 0; i < 180; i++) {
					step();
					if (game.physics.snapshot().grounded && i > 0) break;
				}
			}
			// Bước tới tâm cột cờ sau cú nhảy cuối của đoạn leo.
			if (goal.level === 5 && game.physics.snapshot().ticks === 9469)
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
		expect(game.adventure.completed).toBe(false);
		if (goal.level < 9) {
			expect(game.physics.progress).toBe(goal.finish.minProgress);
			expect(state.x).toBeLessThan(required(floorEnds[goal.level - 1]));
		}
		expect(state.x + PHYSICS.bodyWidth).toBeGreaterThan(goal.finish.minCenterX);
		expect(state.ticks).toBe(
			[1021, 1815, 4078, 5524, 7538, 9253, 12908, 14058, 16036][goal.level - 1],
		);
		const airborne = { ...state, grounded: false };
		game.physics.restore(airborne);
		expect(game.finished).toBe(false);
	});

test("Room 9 finishes without starting the Community ending", () => {
	const world = roomMap(map, 9),
		marker = required(findFinishPlatform(world)),
		game = new GameSimulation(world);
	game.physics.restore({
		...game.physics.snapshot(),
		x: marker.x + (marker.width - PHYSICS.bodyWidth) / 2,
		y: marker.y - PHYSICS.bodyHeight,
		screen: marker.screen,
		grounded: true,
	});
	expect(game.finished).toBe(true);
	game.tick(NEUTRAL_INPUT);
	expect(game.adventure.completed).toBe(false);
});

test("invalid Room map numbers fail closed", () => {
	for (const level of [0, 10, 1.5, NaN])
		expect(() => roomMap(map, level)).toThrow();
});
