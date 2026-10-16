import { expect, test } from "vitest";
import rawMap from "../../../../common/maps/main-babe.json";
import { Simulation } from "./Simulation";
import { type GameMap, NEUTRAL_INPUT as idle } from "./types";

const world: GameMap = {
	...rawMap,
	screens: [
		{
			wind: false,
			tiles: Array.from({ length: 45 }, (_, row) =>
				((row >= 20 && row <= 25) || row >= 41 ? "#" : " ").repeat(60),
			),
		},
	],
};

test("fly is denied by default and cancel does not toggle enabled flight", () => {
	const denied = new Simulation(world);
	expect(() => denied.tick({ ...idle, freeFlight: true })).toThrow("disabled");
	const sim = new Simulation(world, true);
	sim.setFlight(true);
	sim.tick({ ...idle, left: true, up: true });
	expect(sim.snapshot()).toMatchObject({
		x: 227.5,
		y: 298.5,
		ticks: 1,
		jumps: 0,
		falls: 0,
	});
	sim.cancelInput();
	sim.tick(idle);
	expect(sim.snapshot().freeFlight).toBe(true);
});

test("holding Jump ascends in flight without charging or counting jumps", () => {
	const sim = new Simulation(world, true);
	sim.setFlight(true);
	for (let i = 0; i < 20; i++) sim.tick({ ...idle, jump: true });
	expect(sim.snapshot()).toMatchObject({
		y: 232,
		vy: -3.5,
		charge: 0,
		jumps: 0,
		freeFlight: true,
	});
	sim.tick(idle);
	expect(sim.snapshot().vy).toBe(0);
	sim.tick({ ...idle, jump: true, up: true, down: true });
	expect(sim.snapshot().vy).toBe(0);
});

test("disabling fly inside solid falls vertically until the entire body is clear", () => {
	const sim = new Simulation(world, true);
	sim.restore({ ...sim.snapshot(), y: 150, grounded: false, freeFlight: true });
	sim.setFlight(false);
	expect(sim.snapshot().phasingFall).toBe(true);
	for (let i = 0; i < 120 && sim.snapshot().phasingFall; i++) {
		sim.tick({ ...idle, left: true, jump: true });
		expect(sim.snapshot().x).toBe(231);
		expect(sim.snapshot().jumps).toBe(0);
	}
	expect(sim.snapshot().phasingFall).toBe(false);
	expect(sim.snapshot().y).toBeGreaterThanOrEqual(208);
	for (let i = 0; i < 100; i++) sim.tick(idle);
	expect(sim.snapshot().grounded).toBe(true);
});

test("disabled feature restore cleans up solid overlap without losing counters", () => {
	const enabled = new Simulation(world, true);
	const saved = {
		...enabled.snapshot(),
		y: 150,
		grounded: false,
		freeFlight: true,
		jumps: 7,
		falls: 2,
		ticks: 100,
	};
	const restored = new Simulation(world);
	restored.restore(saved);
	expect(restored.snapshot()).toMatchObject({
		freeFlight: false,
		phasingFall: true,
		jumps: 7,
		falls: 2,
		ticks: 100,
	});
	restored.restore({ ...saved, y: 333 });
	for (let i = 0; i < 30 && restored.snapshot().phasingFall; i++)
		restored.tick(idle);
	expect(restored.snapshot()).toMatchObject({
		x: 231,
		y: 302,
		phasingFall: false,
		jumps: 7,
		falls: 2,
	});
	expect(restored.snapshot().ticks).toBeGreaterThan(100);
});

test("flight clamps the whole body inside map bounds", () => {
	const sim = new Simulation(rawMap, true);
	sim.setFlight(true);
	for (let i = 0; i < 6000; i++) sim.tick({ ...idle, right: true, up: true });
	expect(sim.snapshot()).toMatchObject({
		x: 462,
		y: -15120,
		screen: 42,
		falls: 0,
		jumps: 0,
	});
});
