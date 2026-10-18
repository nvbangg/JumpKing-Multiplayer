import { expect, test } from "vitest";
import fixtures from "../../../../common/fixtures/adventure-traces.json";
import checkpoints from "../../../../common/fixtures/main-babe-checkpoints.json";
import route from "../../../../common/fixtures/main-babe-route.json";
import map from "../../../../common/maps/main-babe.json";
import { required } from "../../required";
import { Adventure } from "./Adventure";
import { GameSimulation } from "./GameSimulation";
import { Simulation } from "./Simulation";
import { NEUTRAL_INPUT } from "./types";

function projection(adventure: Adventure) {
	const state = adventure.snapshot();
	return {
		flags: state.flags,
		readables: Object.fromEntries(
			Object.entries(state.readables).filter(([, s]) => s.wait > 0 || s.done),
		),
		dialogue: Object.fromEntries(
			Object.entries(state.dialogue).map(([id, s]) => [
				id,
				{
					introduced: s.introduced,
					best: s.best,
					loop: s.loop,
					flags: s.flags,
					line: s.line,
					ticks: s.ticks,
					wait: s.wait,
					busy: s.busy,
					talks: s.talks,
					quoteLengths:
						s.quote === null ? [] : adventure.quoteLengths(id, s.quote),
					poolLengths: s.pool.map((quote) => adventure.quoteLengths(id, quote)),
				},
			]),
		),
	};
}
test.each(fixtures.cases)(
	"adventure matches independent checkpoints: $name",
	(fixture) => {
		let adventure = new Adventure(map),
			player = new Simulation(map).snapshot();
		for (const [index, step] of fixture.steps.entries()) {
			if ("operation" in step) {
				expect(step.operation).toBe("COMPLETE");
				adventure.complete();
			} else {
				player = { ...player, ...step.player };
				for (let i = 0; i < step.ticks; i++) {
					player.ticks++;
					adventure.tick(player, step.input);
				}
			}
			expect(projection(adventure), `${fixture.name}/${index}`).toEqual(
				step.expected,
			);
			const restored = new Adventure(map);
			restored.restore(adventure.snapshot());
			adventure = restored;
		}
	},
);
test("restores dialogue atomically and rejects malformed counters and flags", () => {
	const adventure = new Adventure(map);
	adventure.complete();
	const saved = adventure.snapshot();
	expect(adventure.completed).toBe(true);
	expect(() =>
		adventure.restore({ ...saved, flags: ["UnknownFlag"] }),
	).toThrow();
	const invalid = structuredClone(saved);
	required(invalid.dialogue.old_man).ticks = -1;
	expect(() => adventure.restore(invalid)).toThrow();
	expect(adventure.snapshot()).toEqual(saved);
});
test("unsupported adventure codec is rejected without changing state", () => {
	const adventure = new Adventure(map);
	const saved = adventure.snapshot();
	expect(() => adventure.restore({ ...saved, codecVersion: 99 })).toThrow(
		"Invalid adventure snapshot",
	);
	expect(adventure.snapshot()).toEqual(saved);
});

test("game restore validates every component before applying and copies caller-owned data", () => {
	const game = new GameSimulation(map);
	game.tick(NEUTRAL_INPUT);
	const before = game.snapshot();
	const invalid = structuredClone(before);
	invalid.physics.x += 10;
	required(invalid.adventure.dialogue.old_man).wait = -1;
	expect(() => game.restore(invalid)).toThrow();
	expect(game.snapshot()).toEqual(before);
	const saved = structuredClone(before);
	saved.physics.x += 5;
	saved.adventure.flags = ["CompletedNormalGame"];
	game.restore(saved);
	const restored = game.snapshot();
	saved.physics.x = 0;
	saved.physics.directions.push(1);
	saved.adventure.flags.length = 0;
	saved.world.registeredScreens.push(42);
	expect(game.snapshot()).toEqual(restored);
});
test("full game restores adventure and environment without changing the legitimate physics route", () => {
	const game = new GameSimulation(map);
	for (let i = 0; i < 30; i++) game.tick(NEUTRAL_INPUT);
	for (const [index, action] of route.entries()) {
		if ("walk" in action) {
			for (let i = 0; i < required(action.ticks); i++)
				game.tick({
					left: required(action.walk) < 0,
					right: required(action.walk) > 0,
					jump: false,
				});
		} else {
			game.tick(NEUTRAL_INPUT);
			for (let i = 0; i < required(action.charge); i++)
				game.tick({
					left: action.charge === 36 && required(action.direction) < 0,
					right: action.charge === 36 && required(action.direction) > 0,
					jump: true,
				});
			if (action.charge !== 36)
				game.tick({
					left: required(action.direction) < 0,
					right: required(action.direction) > 0,
					jump: false,
				});
			for (let i = 0; i < 180; i++) {
				game.tick(NEUTRAL_INPUT);
				if (game.physics.snapshot().grounded && i > 0) break;
			}
		}
		expect(game.physics.snapshot()).toEqual(checkpoints[index]);
		if (index % 17 === 0) game.restore(game.snapshot());
	}
	expect(game.finished).toBe(true);
	expect(game.adventure.completed).toBe(true);
	expect(new Set(game.snapshot().world.registeredScreens).size).toBe(43);
	const state = game.snapshot();
	expect(() =>
		game.restore({
			...state,
			world: { ...state.world, lastTick: state.physics.ticks + 1 },
		}),
	).toThrow();
	expect(game.snapshot()).toEqual(state);
});
