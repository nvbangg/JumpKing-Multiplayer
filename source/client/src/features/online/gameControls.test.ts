import { afterEach, beforeEach, expect, test, vi } from "vitest";
import rules from "../../../../common/rules.json";
import { createGameControls } from "./gameControls";

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
	vi.stubGlobal(
		"window",
		Object.assign(new EventTarget(), { setInterval, clearInterval }),
	);
	vi.stubGlobal(
		"document",
		Object.assign(new EventTarget(), { hidden: false }),
	);
	vi.stubGlobal("Element", class {});
	vi.stubGlobal("navigator", { getGamepads: () => [] });
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test("mouse, chat keyboard and touch reset AFK; only inactivity opens the menu", () => {
	const pause = vi.fn();
	const controls = createGameControls({
		pause,
		cancel: vi.fn(),
		jump: vi.fn(),
		pauseWhenIdle: () => true,
	});
	for (const event of ["pointermove", "keydown", "pointerdown", "wheel"]) {
		vi.advanceTimersByTime(rules.afkMs - 1000);
		window.dispatchEvent(new Event(event));
	}
	expect(pause).not.toHaveBeenCalled();
	vi.advanceTimersByTime(rules.afkMs);
	expect(pause).toHaveBeenCalledOnce();
	controls.dispose();
	vi.advanceTimersByTime(rules.afkMs);
	expect(pause).toHaveBeenCalledOnce();
});

test("blur and hidden cancel a charge without pausing or blocking the next input", () => {
	const pause = vi.fn(),
		cancel = vi.fn();
	const controls = createGameControls({
		pause,
		cancel,
		jump: vi.fn(),
		pauseWhenIdle: () => true,
	});
	const key = (type: string) =>
		window.dispatchEvent(
			Object.assign(new Event(type), { code: "Space", repeat: false }),
		);
	key("keydown");
	expect(controls.input.read().jump).toBe(true);
	window.dispatchEvent(new Event("blur"));
	Object.assign(document, { hidden: true });
	document.dispatchEvent(new Event("visibilitychange"));
	expect(cancel).toHaveBeenCalledTimes(2);
	expect(pause).not.toHaveBeenCalled();
	expect(controls.input.read().jump).toBe(false);
	key("keyup");
	key("keydown");
	expect(controls.input.read().jump).toBe(true);
	controls.dispose();
});
