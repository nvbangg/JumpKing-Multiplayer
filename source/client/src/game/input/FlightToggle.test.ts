import { expect, test } from "vitest";
import { FlightToggle } from "./FlightToggle";

test("flight requires the environment gate and pairs distinct presses", () => {
	let flying = false;
	const changes: boolean[] = [];
	const set = (value: boolean) => {
		flying = value;
		changes.push(value);
	};
	const forbidden = new FlightToggle(false, () => flying, set);
	forbidden.press(0);
	forbidden.press(200);
	expect(changes).toEqual([]);
	const toggle = new FlightToggle(true, () => flying, set);
	toggle.press(0);
	toggle.press(300);
	expect(flying).toBe(true);
	toggle.press(400);
	expect(flying).toBe(true);
	toggle.press(700);
	expect(flying).toBe(false);
	toggle.press(800);
	toggle.press(1101);
	expect(changes).toEqual([true, false]);
	toggle.cancel();
	toggle.press(1200);
	expect(flying).toBe(false);
	toggle.press(1250);
	expect(flying).toBe(true);
});

test("clock rewind and cancel cannot complete a stale double tap", () => {
	let flying = false;
	const toggle = new FlightToggle(
		true,
		() => flying,
		(value) => {
			flying = value;
		},
	);
	toggle.press(1000);
	toggle.press(900);
	expect(flying).toBe(false);
	toggle.cancel();
	toggle.press(1100);
	expect(flying).toBe(false);
});
