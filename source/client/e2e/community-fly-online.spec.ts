import { expect, test } from "@playwright/test";
import type { OnlineSnapshot } from "../src/game/netcode/OnlineRuntime";
import { required } from "../src/required";
import {
	leaveOnline,
	newCommunity,
	observeOnline,
	registerOnline,
} from "./support/online";

test.skip(
	process.env.E2E_FLY_ONLINE !== "true",
	"Requires the backend/MySQL flight harness with Fly enabled",
);
test("Community region follows the screen while still airborne", async ({
	page,
}, info) => {
	const observed = observeOnline(page);
	try {
		await registerOnline(page, "region");
		await newCommunity(page);
		const caption = page.getByLabel("Current region", { exact: true });
		await expect(caption).toHaveText("Redcrown Woods");
		await expect(caption).toHaveCSS("animation-duration", "6s");
		await page.locator("canvas").click();
		await page.keyboard.press("Space");
		await page.waitForTimeout(80);
		await page.keyboard.press("Space");
		await expect
			.poll(() => observed.snapshot?.self.simulation.physics.freeFlight)
			.toBe(true);
		await page.keyboard.down("ArrowUp");
		await expect
			.poll(() => observed.snapshot?.self.simulation.physics.screen ?? 0, {
				timeout: 15000,
			})
			.toBeGreaterThanOrEqual(6);
		await page.keyboard.up("ArrowUp");
		await expect(caption).toHaveText("Colossal Drain");
		expect(observed.snapshot?.self.simulation.physics.freeFlight).toBe(true);
		await expect(caption).toHaveCSS("opacity", "0.25");
		const bounds = required(await caption.boundingBox()),
			viewport = required(await page.locator(".game-viewport").boundingBox());
		expect(bounds.x).toBeLessThan(viewport.x + viewport.width * 0.1);
		expect(bounds.y).toBeGreaterThan(viewport.y + viewport.height * 0.8);
		await page.screenshot({ path: info.outputPath("screen-region.png") });
		await page.setViewportSize({ width: 844, height: 390 });
		await page.screenshot({
			path: info.outputPath("screen-region-mobile.png"),
		});
	} finally {
		await page.keyboard.up("ArrowUp");
		await leaveOnline(page);
	}
});

test("server-enabled flight, double Space and movement save and Continue online flight", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	const snapshots: OnlineSnapshot[] = [],
		errors: unknown[] = [];
	page.on("websocket", (socket) =>
		socket.on("framereceived", (frame) => {
			const message = JSON.parse(frame.payload.toString());
			if (message.type === "GAME_SNAPSHOT") snapshots.push(message.payload);
			if (message.type === "ERROR") errors.push(message.payload);
		}),
	);
	const name = `flight_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
	await page.goto("/");
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await page.getByLabel("Username", { exact: true }).fill(name);
	await page
		.getByLabel("Password", { exact: true })
		.fill("A secure flight browser password");
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu (Esc)", exact: true }),
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	await page.keyboard.press("Space");
	await page.waitForTimeout(80);
	await page.keyboard.press("Space");
	await expect
		.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
		.toBe(true);
	const initialY = required(snapshots.at(-1)).self.simulation.physics.y,
		run = required(snapshots.at(-1)).playId;
	await page.waitForTimeout(400);
	await page.keyboard.down("Space");
	await page.waitForTimeout(250);
	await page.keyboard.up("Space");
	await page.waitForTimeout(400);
	expect(required(snapshots.at(-1)).self.simulation.physics.y).toBe(initialY);
	await page.keyboard.down("KeyW");
	await page.waitForTimeout(250);
	await page.keyboard.up("KeyW");
	await expect
		.poll(() => snapshots.at(-1)?.self.simulation.physics.y)
		.toBeLessThan(initialY - 40);
	await page.keyboard.press("Space");
	await page.waitForTimeout(80);
	await page.keyboard.press("Space");
	await expect
		.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
		.toBe(false);
	await page.waitForTimeout(400);
	await page.keyboard.press("Space");
	await page.waitForTimeout(80);
	await page.keyboard.press("Space");
	await expect
		.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
		.toBe(true);
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "New Game", exact: true }),
	).toBeVisible();
	const best = (
		await (await page.request.get("/api/leaderboard")).json()
	).entries.find((entry: { username: string }) => entry.username === name);
	expect(best.id).toBe(run);
	expect(best.maxProgress).toBe(0);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu (Esc)", exact: true }),
	).toBeVisible();
	await expect.poll(() => snapshots.at(-1)?.playId).toBe(run);
	await expect
		.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
		.toBe(true);
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	await page.keyboard.press("Space");
	await page.waitForTimeout(80);
	await page.keyboard.press("Space");
	await expect
		.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
		.toBe(false);
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "New Game", exact: true }),
	).toBeVisible();
	expect(errors).toEqual([]);
});
