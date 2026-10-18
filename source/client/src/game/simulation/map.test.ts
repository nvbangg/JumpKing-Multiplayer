import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import rawMap from "../../../../common/maps/main-babe.json";
import { parseMap } from "./map";
import { PHYSICS } from "./tuning";

test("Main Babe geometry and adventure have no presentation fields", () => {
	const map = parseMap(rawMap);
	expect(map.screens).toHaveLength(43);
	expect(
		[...new Set(map.screens.flatMap((s) => s.tiles.join("").split("")))].sort(),
	).toEqual([" ", "#", "I", "N", "a", "b", "c", "d"]);
	const adventure = readFileSync(
		new URL("../../../../common/adventure.json", import.meta.url),
		"utf8",
	);
	for (const field of ["texture", "lines", "font", "sound", "intro", "quotes"])
		expect(adventure).not.toContain(`"${field}"`);
	expect(() =>
		parseMap({ ...rawMap, screens: rawMap.screens.slice(0, 42) }),
	).toThrow();
	expect(() =>
		parseMap({
			...rawMap,
			screens: [
				{ ...rawMap.screens[0], texture: "x" },
				...rawMap.screens.slice(1),
			],
		}),
	).toThrow();
});

test("tuning retains native float32 gravity and launch velocity", () => {
	expect(PHYSICS.gravity).toBe(0.2571428716182709);
	expect(PHYSICS.jumpVelocity).toBe(-8.742857933044434);
	expect(PHYSICS.chargeTicks).toBe(36);
});
