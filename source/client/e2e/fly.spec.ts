import { expect, test } from "@playwright/test";
import physics from "../../common/physics.json" with { type: "json" };
import { required } from "../src/required";

import {
	leaveOnline,
	newCommunity,
	observeOnline,
	registerOnline,
} from "./support/online";

const enabled = process.env.E2E_FLY_ENABLED === "true";
test("Flight follows the server permission and double Space toggles real Community flight", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	test.skip(
		process.env.E2E_FLY_ONLINE !== "true",
		"Requires Fly online harness",
	);
	const observed = observeOnline(page);
	await registerOnline(page, "fly");
	await page.getByRole("button", { name: "Options", exact: true }).click();
	await expect(page.getByRole("switch", { name: /Fly Mode/ })).toHaveCount(0);
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await newCommunity(page);
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Space");
	await page.keyboard.press("Space");
	if (enabled) {
		await page.keyboard.down("KeyD");
		await page.waitForTimeout(200);
		await page.keyboard.up("KeyD");
		await page.waitForTimeout(400);
		await page.keyboard.down("KeyW");
		await page.waitForTimeout(200);
		await page.keyboard.up("KeyW");
	}
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	const first = required(observed.snapshot).self.simulation.physics;
	expect(first.freeFlight).toBe(enabled);
	if (!enabled) return;
	expect(first.x).toBeGreaterThan(231);
	expect(first.y).toBeLessThan(302);
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Space");
	await page.keyboard.press("Space");
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	const off = required(observed.snapshot).self.simulation.physics;
	expect(off.freeFlight).toBe(false);
	expect(off.jumps).toBe(first.jumps);
	await leaveOnline(page);
});

test("touch double Jump respects the gate and simultaneous Jump fingers are one press", async ({
	page,
	context,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	test.skip(
		process.env.E2E_FLY_ONLINE !== "true",
		"Requires Fly online harness",
	);
	const observed = observeOnline(page);
	await registerOnline(page, "fly_touch");
	await newCommunity(page);
	const jump = page.getByRole("button", { name: "Jump", exact: true });
	await expect(jump).toBeVisible();
	const cdp = await context.newCDPSession(page),
		box = required(await jump.boundingBox());
	const point = (id: number) => ({
		id,
		x: box.x + box.width / 2,
		y: box.y + box.height / 2,
	});
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [point(1)],
	});
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [point(1), point(2)],
	});
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	});
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	expect(required(observed.snapshot).self.simulation.physics.freeFlight).toBe(
		false,
	);
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	await page.waitForTimeout(physics.flyDoubleTapMs + 1);
	for (let tap = 0; tap < 2; tap++) {
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [point(1)],
		});
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});
	}
	if (enabled)
		await expect(
			page.getByRole("button", { name: "Move Up", exact: true }),
		).toBeVisible();
	else
		await expect(
			page.getByRole("button", { name: "Move Up", exact: true }),
		).toBeHidden();
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	expect(required(observed.snapshot).self.simulation.physics.freeFlight).toBe(
		enabled,
	);
	await leaveOnline(page);
});
