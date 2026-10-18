import { expect, test } from "vitest";
import traces from "../../../../common/fixtures/physics-traces.json";
import { required } from "../../required";
import { Simulation } from "./Simulation";
import type { PlayerState } from "./types";

for (const trace of traces.cases) {
	test(`per-tick oracle: ${trace.name}`, () => {
		const sim = new Simulation(trace.map);
		sim.restore(trace.initial as PlayerState);
		for (let i = 0; i < trace.frames.length; i++) {
			const frame = required(trace.frames[i]);
			sim.tick(frame.input);
			expect(sim.snapshot(), `tick ${i + 1}`).toEqual(frame.state);
		}
	});
}
