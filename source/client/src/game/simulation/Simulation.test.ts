import { expect, test } from "vitest";
import checkpoints from "../../../../common/fixtures/main-babe-checkpoints.json";
import route from "../../../../common/fixtures/main-babe-route.json";
import rawMap from "../../../../common/maps/main-babe.json";
import { required } from "../../required";
import { parseMap } from "./map";
import { Simulation } from "./Simulation";
import { PHYSICS as P } from "./tuning";
import { type GameMap, NEUTRAL_INPUT as idle } from "./types";

const map = parseMap(rawMap);
function settled(world = map, noWalk = false) {
	const sim = new Simulation(world, false, noWalk);
	for (let i = 0; i < 30; i++) sim.tick(idle);
	return sim;
}
function ground(tile = "#"): GameMap {
	return {
		...map,
		finish: { ...map.finish, screen: 0 },
		screens: [
			{
				wind: false,
				tiles: Array.from({ length: 45 }, (_, row) =>
					(row >= 41 ? tile : " ").repeat(60),
				),
			},
		],
	};
}

test("full charge auto-launches and held jump cannot re-arm", () => {
	const sim = settled(ground());
	for (let i = 0; i < 36; i++) sim.tick({ ...idle, right: true, jump: true });
	expect(sim.snapshot().jumps).toBe(1);
	expect(sim.snapshot().vy).toBe(P.jumpVelocity);
	for (let i = 0; i < 180; i++) sim.tick({ ...idle, jump: true });
	expect(sim.snapshot().jumps).toBe(1);
});

test("release includes its tick of charge while cancel never launches", () => {
	const sim = settled(ground());
	sim.tick({ ...idle, jump: true });
	sim.tick(idle);
	expect(sim.snapshot().vy).toBe(Math.fround(P.jumpVelocity * (2 / 36)));
	const canceled = settled(ground());
	for (let i = 0; i < 20; i++) canceled.tick({ ...idle, jump: true });
	canceled.cancelInput();
	canceled.tick(idle);
	expect(canceled.snapshot().jumps).toBe(0);
});

test("buffer chooses direction and airborne input cannot steer", () => {
	const sim = settled(ground());
	for (let i = 0; i < 10; i++) sim.tick({ ...idle, left: true, jump: true });
	sim.tick(idle);
	expect(sim.snapshot().vx).toBe(-3.5);
	sim.tick({ ...idle, right: true });
	expect(sim.snapshot().vx).toBe(-3.5);
});

test("snow rejects weak charge and raises a small valid charge", () => {
	const sim = settled(ground("N"));
	for (let i = 0; i < 6; i++) sim.tick({ ...idle, jump: true });
	sim.tick(idle);
	expect(sim.snapshot().jumps).toBe(0);
	sim.tick(idle);
	for (let i = 0; i < 7; i++) sim.tick({ ...idle, jump: true });
	sim.tick(idle);
	expect(sim.snapshot().vy).toBe(Math.fround(P.jumpVelocity * 0.3));
});

test("No Walk removes walking intent while allowing horizontal jumps", () => {
	const sim = settled(ground(), true),
		start = sim.snapshot().x;
	for (let i = 0; i < 20; i++) sim.tick({ ...idle, right: true });
	expect(sim.snapshot().x).toBe(start);
	for (let i = 0; i < 36; i++) sim.tick({ ...idle, right: true, jump: true });
	expect(sim.snapshot().vx).toBe(3.5);
	sim.tick(idle);
	expect(sim.snapshot().x).toBeGreaterThan(start);
});

test("codec restores exact replay and rejects malformed state", () => {
	const sim = settled();
	for (let i = 0; i < 12; i++) sim.tick({ ...idle, jump: true });
	const saved = sim.snapshot(),
		replay = new Simulation(map);
	replay.restore(JSON.parse(JSON.stringify(saved)));
	for (let i = 0; i < 200; i++) {
		const input = { ...idle, right: i < 5, jump: i < 10 };
		expect(replay.tick(input)).toEqual(sim.tick(input));
		expect(replay.snapshot()).toEqual(sim.snapshot());
	}
	expect(() => replay.restore({ ...saved, x: NaN })).toThrow();
	expect(() =>
		replay.restore({ ...saved, codecVersion: 2 } as never),
	).toThrow();
});

test("legitimate replay reaches Finish through all 43 screens without fly or teleport", () => {
	let sim = settled();
	const visited = new Set([0]);
	const step = (input = idle) => {
		sim.tick(input);
		visited.add(sim.snapshot().screen);
	};
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
				if (sim.snapshot().grounded && i > 0) break;
			}
		}
		expect(sim.snapshot(), `route checkpoint ${index}`).toEqual(
			checkpoints[index],
		);
		if (index % 17 === 0) {
			const resumed = new Simulation(map);
			resumed.restore(JSON.parse(JSON.stringify(sim.snapshot())));
			sim = resumed;
		}
	}
	expect(visited.size).toBe(43);
	expect(sim.snapshot().jumps).toBe(228);
	expect(sim.snapshot().falls).toBe(0);
	expect(sim.finished).toBe(true);
	expect(sim.snapshot().ticks).toBe(16957);
});
