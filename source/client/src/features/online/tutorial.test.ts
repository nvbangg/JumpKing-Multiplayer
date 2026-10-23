import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
	isTutorialCompleted,
	nextTutorialStep,
	saveTutorialCompleted,
} from "./tutorial";

class MockStorage implements Storage {
	private map = new Map<string, string>();
	get length() {
		return this.map.size;
	}
	clear() {
		this.map.clear();
	}
	getItem(key: string): string | null {
		return this.map.get(key) ?? null;
	}
	key(index: number): string | null {
		return Array.from(this.map.keys())[index] ?? null;
	}
	removeItem(key: string) {
		this.map.delete(key);
	}
	setItem(key: string, value: string) {
		this.map.set(key, String(value));
	}
}

let mockStorage: MockStorage;

beforeEach(() => {
	mockStorage = new MockStorage();
	vi.stubGlobal("localStorage", mockStorage);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

test("tutorial stays available until this account completes or skips it", () => {
	expect(isTutorialCompleted("user1")).toBe(false);
	expect(isTutorialCompleted()).toBe(false);
});

test("saveTutorialCompleted marks account as completed in localStorage", () => {
	expect(isTutorialCompleted("user1")).toBe(false);
	saveTutorialCompleted("user1");
	expect(isTutorialCompleted("user1")).toBe(true);
	expect(isTutorialCompleted("user2")).toBe(false);
});

test("isTutorialCompleted handles localStorage exceptions gracefully", () => {
	vi.spyOn(mockStorage, "getItem").mockImplementation(() => {
		throw new Error("Storage blocked");
	});
	expect(isTutorialCompleted("user1")).toBe(false);
});

test("nextTutorialStep transitions from move to charge when moved >= 8 pixels", () => {
	const originX = 100;
	expect(
		nextTutorialStep(
			"move",
			{ x: 104, vx: 0, charge: 0, grounded: true, jumps: 0 },
			{ x: originX, jumps: 0 },
		),
	).toBe("move");
	expect(
		nextTutorialStep(
			"move",
			{ x: 108, vx: 0, charge: 0, grounded: true, jumps: 0 },
			{ x: originX, jumps: 0 },
		),
	).toBe("charge");
	expect(
		nextTutorialStep(
			"move",
			{ x: 92, vx: 0, charge: 0, grounded: true, jumps: 0 },
			{ x: originX, jumps: 0 },
		),
	).toBe("charge");
});

test("nextTutorialStep transitions from charge to jump when charge >= 4 ticks", () => {
	expect(
		nextTutorialStep(
			"charge",
			{ x: 100, vx: 0, charge: 3, grounded: true, jumps: 0 },
			{ x: 100, jumps: 0 },
		),
	).toBe("charge");
	expect(
		nextTutorialStep(
			"charge",
			{ x: 100, vx: 0, charge: 4, grounded: true, jumps: 0 },
			{ x: 100, jumps: 0 },
		),
	).toBe("jump");
});

test("nextTutorialStep falling does not complete the jump step", () => {
	expect(
		nextTutorialStep(
			"jump",
			{ x: 100, vx: 0, charge: 0, grounded: true, jumps: 0 },
			{ x: 100, jumps: 0 },
		),
	).toBe("jump");
	expect(
		nextTutorialStep(
			"jump",
			{ x: 100, vx: 0, charge: 0, grounded: false, jumps: 0 },
			{ x: 100, jumps: 0 },
		),
	).toBe("jump");
	expect(
		nextTutorialStep(
			"completed",
			{ x: 100, vx: 0, charge: 0, grounded: true, jumps: 0 },
			{ x: 100, jumps: 0 },
		),
	).toBe("completed");
});

test("a jump cannot bypass move or charge", () => {
	for (const step of ["move", "charge"] as const)
		expect(
			nextTutorialStep(
				step,
				{ x: 120, vx: 3, charge: 0, grounded: false, jumps: 3 },
				{ x: 100, jumps: 2 },
			),
		).toBe(step);
});

test("the jump step requires a new directional jump", () => {
	const origin = { x: 100, jumps: 2 };
	expect(
		nextTutorialStep(
			"jump",
			{ x: 100, vx: 0, charge: 0, grounded: false, jumps: 3 },
			origin,
		),
	).toBe("jump");
	expect(
		nextTutorialStep(
			"jump",
			{ x: 110, vx: 1.5, charge: 0, grounded: true, jumps: 3 },
			origin,
		),
	).toBe("jump");
	expect(
		nextTutorialStep(
			"jump",
			{ x: 110, vx: -3, charge: 0, grounded: false, jumps: 3 },
			origin,
		),
	).toBe("completed");
});

test("Fly and existing jump counts do not complete the guide", () => {
	expect(
		nextTutorialStep(
			"jump",
			{ x: 100, vx: 0, charge: 0, grounded: false, jumps: 2 },
			{ x: 100, jumps: 2 },
		),
	).toBe("jump");
	expect(
		nextTutorialStep(
			"move",
			{ x: 200, vx: 0, charge: 0, grounded: false, jumps: 0, freeFlight: true },
			{ x: 100, jumps: 0 },
		),
	).toBe("move");
});
