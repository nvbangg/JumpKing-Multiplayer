import { expect, test } from "vitest";
import raw from "../../../../common/maps/main-babe.json";
import { parseMap } from "./map";
import { Simulation } from "./Simulation";
import { NEUTRAL_INPUT } from "./types";

for (const noWalk of [false, true])
	test(`slip replay has no friction and stops at boundary (${noWalk})`, () => {
		const map = parseMap(structuredClone(raw));
		map.spawn = { x: 100, y: 326 };
		map.screens = [
			{
				wind: false,
				tiles: [...Array<string>(44).fill(" ".repeat(60)), "I".repeat(60)],
			},
		];
		map.finish = {
			screen: 0,
			minCenterX: 0,
			requiresGrounded: true,
			minProgress: 9999,
		};
		const sim = new Simulation(map, false, noWalk);
		sim.tick(NEUTRAL_INPUT);
		sim.restore({
			...sim.snapshot(),
			vx: 6,
			slipping: true,
			jumpConsumed: true,
		});
		for (let i = 0; i < 20; i++)
			sim.tick({ left: true, right: false, jump: true });
		expect(sim.snapshot().x).toBe(220);
		expect(sim.snapshot().vx).toBe(6);
		expect(sim.snapshot().jumps).toBe(0);
		expect(sim.snapshot().charge).toBe(0);
		const restored = new Simulation(map, false, noWalk);
		restored.restore(sim.snapshot());
		for (let i = 0; i < 60; i++) {
			sim.tick(NEUTRAL_INPUT);
			restored.tick(NEUTRAL_INPUT);
		}
		expect(sim.snapshot().x).toBe(471);
		expect(sim.snapshot().vx).toBe(0);
		expect(sim.snapshot().slipping).toBeUndefined();
		expect(restored.snapshot()).toEqual(sim.snapshot());
	});
