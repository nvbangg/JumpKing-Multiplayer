import { expect, test } from "@playwright/test";
import { soloJumps } from "./support/solo";

test("touch holds direction and Jump simultaneously and cancellation never launches", async ({
	page,
	context,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/play");
	const jump = page.getByRole("button", { name: "Jump", exact: true });
	await expect(jump).toBeVisible();
	const bounds = await jump.boundingBox(),
		left = await page
			.getByRole("button", { name: "Move Left", exact: true })
			.boundingBox();
	const cdp = await context.newCDPSession(page);
	const point = (box: NonNullable<typeof bounds>, id: number) => ({
		id,
		x: box.x + box.width / 2,
		y: box.y + box.height / 2,
	});
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [point(bounds!, 1)],
	});
	await page.waitForTimeout(120);
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchCancel",
		touchPoints: [],
	});
	await page.waitForTimeout(250);
	await expect.poll(() => soloJumps(page)).toBe(0);
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [point(left!, 1), point(bounds!, 2)],
	});
	await expect.poll(() => soloJumps(page)).toBe(1);
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	});
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Paused", exact: true }),
	).toBeVisible();
});

test("gamepad changes count as activity and held input is blocked across cancel/resume", async ({
	page,
}) => {
	await page.goto("/");
	const result = await page.evaluate(async () => {
		const path = "/src/game/input/InputController.ts";
		const { InputController } = await import(path);
		let activity = 0,
			canceled = 0,
			menus = 0;
		let pad: Record<string, unknown> | null = {
			connected: true,
			axes: [-0.8, 0],
			buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 0 })),
		};
		Object.defineProperty(navigator, "getGamepads", {
			configurable: true,
			value: () => [pad],
		});
		const input = new InputController(
			() => activity++,
			() => {
				menus++;
				input.cancel();
			},
			() => canceled++,
		);
		const initial = input.read();
		const afterChange = activity;
		input.read();
		input.read();
		const heldActivity = activity;
		input.cancel();
		input.resume();
		const blocked = input.read();
		pad = { connected: true, axes: [0, 0], buttons: [] };
		input.read();
		pad = { connected: true, axes: [0, 0], buttons: [{ pressed: true }] };
		const rearmed = input.read();
		pad = null;
		input.read();
		pad = {
			connected: true,
			axes: [0, 0],
			buttons: Array.from({ length: 10 }, (_, i) => ({ pressed: i === 9 })),
		};
		const menuInput = input.read();
		input.resume();
		Object.defineProperty(navigator, "getGamepads", {
			value: () => {
				throw new DOMException("Blocked", "SecurityError");
			},
		});
		input.read();
		window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
		const keyboard = input.read();
		input.dispose();
		return {
			initial,
			afterChange,
			heldActivity,
			blocked,
			rearmed,
			canceled,
			menus,
			menuInput,
			keyboard,
		};
	});
	expect(result.initial).toMatchObject({ left: true, jump: true });
	expect(result.heldActivity).toBe(result.afterChange);
	expect(result.blocked).toMatchObject({ left: false, jump: false });
	expect(result.rearmed.jump).toBe(true);
	expect(result.canceled).toBe(1);
	expect(result.keyboard.right).toBe(true);
	expect(result.menus).toBe(1);
	expect(result.menuInput.jump).toBe(false);
});
