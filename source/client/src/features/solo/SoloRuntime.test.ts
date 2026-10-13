import { expect, test } from "vitest";
import checkpoints from "../../../../common/fixtures/main-babe-checkpoints.json";
import map from "../../../../common/maps/main-babe.json";
import { NEUTRAL_INPUT } from "../../game/simulation/types";
import { SoloRuntime } from "./SoloRuntime";

test("fixed ticks accumulate small frames and pause/resume discards elapsed wall time", () => {
	const session = new SoloRuntime(
		map,
		() => NEUTRAL_INPUT,
		() => {},
	);
	session.advance(8);
	session.advance(8);
	expect(session.simulation.snapshot().ticks).toBe(0);
	session.advance(1);
	expect(session.simulation.snapshot().ticks).toBe(1);
	session.pause();
	session.advance(5000);
	expect(session.simulation.snapshot().ticks).toBe(1);
	session.resume();
	session.advance(1000 / 60);
	expect(session.simulation.snapshot().ticks).toBe(2);
});
test("restoring at Finish grants the reward before autosave and exposes one ending signal", () => {
	const session = new SoloRuntime(
		map,
		() => NEUTRAL_INPUT,
		() => {},
	);
	const snapshot = session.game.snapshot();
	snapshot.physics = { ...checkpoints.at(-1)!, codecVersion: 1 };
	snapshot.world.lastTick = snapshot.physics.ticks;
	session.restore(snapshot);
	expect(session.game.adventure.completed).toBe(true);
	const signal = session.frame().ending;
	session.advance(1000);
	session.advance(1000);
	expect(session.frame().ending).toBe(signal);
	expect(session.simulation.snapshot().ticks).toBe(16957);
});
