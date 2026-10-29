import { expect, test } from "vitest";
import fixture from "../../../../common/fixtures/easy-respawn.json";
import raw from "../../../../common/maps/main-babe.json";
import { GameSimulation } from "./GameSimulation";
import { parseMap } from "./map";
import { roomMap } from "./roomMaps";
import { NEUTRAL_INPUT } from "./types";

const map = parseMap(raw);

test("Easy restores its saved point across the lower Room boundary, including snapshot replay", () => {
	for (const mode of ["EASY", "RACE", "HARDCORE", "NO_WALK"]) {
		const stage = roomMap(map, 2);
		const game = new GameSimulation(stage);
		const saved = game.snapshot();
		const safe = { x: stage.spawn.x + 8, y: stage.spawn.y - 360 };
		saved.world.safePosition = safe;
		saved.physics.y = stage.spawn.y + 30;
		saved.physics.grounded = false;
		game.restore(saved);
		const before = game.snapshot();
		const replay = new GameSimulation(stage);
		replay.restore(before);
		expect(game.tick(NEUTRAL_INPUT, mode).movement).toContain("SPLAT");
		replay.tick(NEUTRAL_INPUT, mode);
		expect(replay.snapshot()).toEqual(game.snapshot());
		expect(game.physics.snapshot()).toMatchObject({
			...(mode === "EASY" ? safe : stage.spawn),
			falls: before.physics.falls + 1,
		});
		expect(game.snapshot().world.safePosition).toEqual(safe);
	}
});

function rememberSafe(game: GameSimulation) {
	game.physics.restore({
		...game.physics.snapshot(),
		...fixture.safe,
		vy: 1,
		ticks: fixture.initialTicks,
		jumps: fixture.jumps,
		falls: fixture.falls,
	});
	game.tick(NEUTRAL_INPUT, "EASY");
}

function arrangeFall(game: GameSimulation) {
	game.physics.restore({
		...game.physics.snapshot(),
		...fixture.fall,
		grounded: false,
	});
}

test("Easy matches the shared respawn oracle without saving the SPLAT landing", () => {
	const game = new GameSimulation(map);
	rememberSafe(game);
	expect(game.snapshot().world.safePosition).toEqual(fixture.safe);
	const visited = game.snapshot().world.registeredScreens;
	arrangeFall(game);
	let splats = 0;
	for (let tick = 0; tick < fixture.fallTicks; tick++)
		if (game.tick(NEUTRAL_INPUT, "EASY").movement.includes("SPLAT")) splats++;
	expect(splats).toBe(1);
	expect(game.physics.snapshot()).toMatchObject(fixture.expected);
	expect(game.snapshot().world).toMatchObject({
		safePosition: fixture.safe,
		lastTick: fixture.expected.ticks,
		registeredScreens: visited,
	});
});

test("Easy remembers the most recent safe landing even below the previous one", () => {
	const game = new GameSimulation(map);
	rememberSafe(game);
	game.physics.restore({ ...game.physics.snapshot(), ...map.spawn, vy: 1 });
	game.tick(NEUTRAL_INPUT, "EASY");
	expect(game.snapshot().world.safePosition).toEqual(map.spawn);
	arrangeFall(game);
	for (let tick = 0; tick < fixture.fallTicks; tick++)
		game.tick(NEUTRAL_INPUT, "EASY");
	expect(game.physics.snapshot()).toMatchObject({ ...map.spawn, splat: 0 });
});

test("Easy leaves the safe point intact during Fly and item sliding", () => {
	const game = new GameSimulation(map, true);
	rememberSafe(game);
	game.tick({ ...NEUTRAL_INPUT, freeFlight: true, right: true }, "EASY");
	expect(game.snapshot().world.safePosition).toEqual(fixture.safe);
	game.physics.restore({
		...game.physics.snapshot(),
		...map.spawn,
		vx: 6,
		vy: 0,
		grounded: true,
		freeFlight: false,
		slipping: true,
	});
	game.tick(NEUTRAL_INPUT, "EASY");
	expect(game.physics.snapshot().slipping).toBe(true);
	expect(game.snapshot().world.safePosition).toEqual(fixture.safe);
});

test("Easy falls back to spawn; Race and Hardcore do not create a safe point", () => {
	for (const mode of ["EASY", "RACE", "HARDCORE"]) {
		const game = new GameSimulation(map);
		arrangeFall(game);
		for (let tick = 0; tick < fixture.fallTicks; tick++)
			game.tick(NEUTRAL_INPUT, mode);
		expect(game.physics.snapshot().splat > 0).toBe(mode === "RACE");
		if (mode !== "RACE")
			expect(game.physics.snapshot()).toMatchObject(map.spawn);
		expect(game.snapshot().world.safePosition).toBeUndefined();
	}
});

test("invalid Easy safe coordinates are rejected without partially restoring the game", () => {
	const game = new GameSimulation(map);
	rememberSafe(game);
	const before = game.snapshot();
	for (const x of [Number.NaN, map.width + 1]) {
		const invalid = structuredClone(before);
		invalid.physics.x = map.spawn.x;
		invalid.world.safePosition = { x, y: fixture.safe.y };
		expect(() => game.restore(invalid)).toThrow("Invalid world snapshot");
		expect(game.snapshot()).toEqual(before);
	}
});
