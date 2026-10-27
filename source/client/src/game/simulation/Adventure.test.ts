import { expect, test } from "vitest";
import fixtures from "../../../../common/fixtures/adventure-traces.json";
import checkpoints from "../../../../common/fixtures/main-babe-checkpoints.json";
import route from "../../../../common/fixtures/main-babe-route.json";
import ravenTrace from "../../../../common/fixtures/raven-trace.json";
import whiteRavenTrace from "../../../../common/fixtures/white-raven-trace.json";
import map from "../../../../common/maps/main-babe.json";
import { required } from "../../required";
import { Adventure } from "./Adventure";
import { GameSimulation } from "./GameSimulation";
import { Simulation } from "./Simulation";
import { NEUTRAL_INPUT } from "./types";

test("raven requires the same screen and strictly less than forty pixels", () => {
	const adventure = new Adventure(map);
	const player = {
		...new Simulation(map).snapshot(),
		screen: 2,
		x: 65,
		y: 88 - 720 - 13,
	};
	expect(adventure.tick(player, NEUTRAL_INPUT)).not.toContainEqual({
		type: "FLEE",
		id: "raven",
	});
	expect(
		adventure.tick({ ...player, screen: 3, x: 25 }, NEUTRAL_INPUT),
	).not.toContainEqual({ type: "FLEE", id: "raven" });
	expect(adventure.tick({ ...player, x: 64 }, NEUTRAL_INPUT)).toContainEqual({
		type: "FLEE",
		id: "raven",
	});
});

test("raven follows all fourteen perches with exact flight and checkpoint continuation", () => {
	let adventure = new Adventure(map);
	const other = new Adventure(map);
	let flees = 0;
	for (const leg of ravenTrace.legs) {
		const player = { ...new Simulation(map).snapshot(), ...leg.player };
		for (let tick = 1; tick <= leg.ticks; tick++) {
			const flee = adventure
				.tick(player, NEUTRAL_INPUT)
				.some((event) => event.type === "FLEE");
			if (flee) flees++;
			const sample = leg.samples.find((sample) => sample.tick === tick);
			if (sample) {
				expect(adventure.snapshot().raven).toEqual(sample.state);
				expect(flee).toBe(sample.flee);
				const restored = new Adventure(map);
				restored.restore(adventure.snapshot());
				adventure = restored;
			}
		}
	}
	expect(flees).toBe(14);
	expect(adventure.ravenDone).toBe(true);
	expect(other.snapshot().raven.index).toBe(0);
	expect(other.ravenDone).toBe(false);
	expect(
		adventure.tick(new Simulation(map).snapshot(), NEUTRAL_INPUT),
	).not.toContainEqual({ type: "FLEE", id: "raven" });
});

test("white raven follows seventeen Main Babe perches without rewards or changing the ending", () => {
	let adventure = new Adventure(map);
	const other = new Adventure(map);
	let flees = 0;
	for (const leg of whiteRavenTrace.legs) {
		const player = { ...new Simulation(map).snapshot(), ...leg.player };
		for (let tick = 1; tick <= leg.ticks; tick++) {
			const flee = adventure
				.tick(player, NEUTRAL_INPUT)
				.some((event) => event.type === "FLEE" && event.id === "whiteRaven");
			if (flee) flees++;
			const sample = leg.samples.find((sample) => sample.tick === tick);
			if (sample) {
				expect(adventure.snapshot().whiteRaven).toEqual(sample.state);
				expect(flee).toBe(sample.flee);
				const restored = new Adventure(map);
				restored.restore(adventure.snapshot());
				adventure = restored;
			}
		}
	}
	expect(flees).toBe(17);
	expect(adventure.snapshot().whiteRaven.done).toBe(true);
	expect(adventure.ravenDone).toBe(false);
	expect(adventure.completed).toBe(false);
	expect(adventure.snapshot().flags).toEqual([]);
	expect(other.snapshot().whiteRaven.index).toBe(0);
	expect(
		adventure.tick(
			{
				...new Simulation(map).snapshot(),
				...whiteRavenTrace.legs[16]?.player,
			},
			NEUTRAL_INPUT,
		),
	).not.toContainEqual({ type: "FLEE", id: "whiteRaven" });
});

test("white raven restore validates progress and preserves recorded black raven state", () => {
	const adventure = new Adventure(map),
		saved = adventure.snapshot();
	for (const value of [
		{ index: 17 },
		{ index: -1 },
		{ x: NaN },
		{ flying: "yes" },
		{ done: true },
	]) {
		expect(() =>
			adventure.restore({
				...saved,
				whiteRaven: { ...saved.whiteRaven, ...value },
			}),
		).toThrow();
		expect(adventure.snapshot()).toEqual(saved);
	}
	const { whiteRaven: _whiteRaven, ...unrecorded } = saved;
	expect(() => adventure.restore(unrecorded)).toThrow();
	expect(adventure.snapshot()).toEqual(saved);
});

test("raven restore rejects corrupt state atomically and rejects missing bird state", () => {
	const adventure = new Adventure(map),
		saved = adventure.snapshot();
	for (const value of [
		{ index: 14 },
		{ index: -1 },
		{ x: NaN },
		{ ticks: 1.5 },
		{ done: true },
		{ flying: "yes" },
	]) {
		expect(() =>
			adventure.restore({ ...saved, raven: { ...saved.raven, ...value } }),
		).toThrow();
		expect(adventure.snapshot()).toEqual(saved);
	}
	const { raven: _raven, ...unrecorded } = saved;
	expect(() => adventure.restore(unrecorded)).toThrow();
	expect(adventure.snapshot()).toEqual(saved);
});

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

test("render view follows simulation while saved snapshots remain independent", () => {
	const game = new GameSimulation(map);
	const saved = game.snapshot();
	const view = game.view();
	game.tick(NEUTRAL_INPUT);
	const next = game.view();
	expect(next.adventure).toBe(view.adventure);
	expect(next.world).toBe(view.world);
	expect(next).toEqual({
		physics: game.snapshot().physics,
		adventure: game.snapshot().adventure,
		world: game.snapshot().world,
	});
	expect(saved.world.lastTick).toBe(0);
	expect(next.world.lastTick).toBe(1);
	saved.adventure.flags.push("saved-only");
	expect(next.adventure.flags).not.toContain("saved-only");
});
