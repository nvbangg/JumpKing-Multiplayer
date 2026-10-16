import { expect, type Page, test } from "@playwright/test";
import physics from "../../common/physics.json" with { type: "json" };

const enabled = process.env.E2E_FLY_ENABLED === "true";
const savedPhysics = (page: Page) =>
	page.evaluate(async () => {
		const path = "/src/features/solo/storage.ts",
			{ currentSolo } = await import(path);
		return (await currentSolo("guest"))?.snapshot?.physics;
	});
test("Flight follows the server permission and double Space toggles real Solo flight", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	await page.goto("/");
	await page.getByRole("button", { name: "Options", exact: true }).click();
	await expect(page.getByRole("switch", { name: /Fly Mode/ })).toHaveCount(0);
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await page
		.getByRole("button", { name: "New Solo Game", exact: true })
		.click();
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
		await page.keyboard.down("Space");
		await page.waitForTimeout(200);
		await page.keyboard.up("Space");
	}
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	const first = await savedPhysics(page);
	expect(first.freeFlight).toBe(enabled);
	if (!enabled) return;
	expect(first.x).toBeGreaterThan(231);
	expect(first.y).toBeLessThan(302);
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await page
		.getByRole("button", { name: "Continue Solo", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Space");
	await page.keyboard.press("Space");
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	const off = await savedPhysics(page);
	expect(off.freeFlight).toBe(false);
	expect(off.jumps).toBe(first.jumps);
});

test("disabling flight inside floor exits solid or safely returns to spawn without a jump", async ({
	page,
}) => {
	await page.goto("/");
	if (!enabled) {
		await page.getByRole("button", { name: "Options", exact: true }).click();
		await expect(page.getByRole("switch", { name: /Fly Mode/ })).toBeHidden();
		return;
	}
	await page.evaluate(async () => {
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false }));
		const simulation = "/src/game/simulation/GameSimulation.ts",
			storage = "/src/features/solo/storage.ts";
		const { GameSimulation } = await import(simulation),
			{ SoloWriter } = await import(storage);
		const map = await (await fetch("/shared/maps/main-babe.json")).json(),
			game = new GameSimulation(map, true);
		game.physics.restore({
			...game.physics.snapshot(),
			x: 16,
			y: 320,
			freeFlight: true,
			grounded: false,
		});
		const writer = await SoloWriter.open("guest", "new", game.snapshot());
		await writer.close();
	});
	await page.goto("/play");
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Space");
	await page.keyboard.press("Space");
	await expect
		.poll(async () => {
			const state = await savedPhysics(page);
			return (
				state &&
				!state.freeFlight &&
				!state.phasingFall &&
				state.x === 231 &&
				state.y === 302
			);
		})
		.toBe(true);
	const state = await savedPhysics(page);
	expect(state.jumps).toBe(0);
	expect(state.falls).toBe(0);
});

test("touch double Jump respects the gate and simultaneous Jump fingers are one press", async ({
	page,
	context,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	await page.goto("/play");
	const jump = page.getByRole("button", { name: "Jump", exact: true });
	await expect(jump).toBeVisible();
	const cdp = await context.newCDPSession(page),
		box = (await jump.boundingBox())!;
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
	expect((await savedPhysics(page)).freeFlight).toBe(false);
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
	expect((await savedPhysics(page)).freeFlight).toBe(enabled);
});
