import { expect, test } from "@playwright/test";
import physics from "../../common/physics.json" with { type: "json" };
import type { OnlineSnapshot } from "../src/game/netcode/OnlineRuntime";
import { required } from "../src/required";
import {
	landOnMapMarker,
	leaveOnline,
	newCommunity,
	observeOnline,
	registerOnline,
} from "./support/online";

test("Community shows Green Woods at start, saves region captions and resets for New Game", async ({
	page,
}) => {
	test.setTimeout(60000);
	const observed = observeOnline(page);
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	try {
		await registerOnline(page, "region");
		await newCommunity(page);
		const caption = page.getByLabel("Current region", { exact: true });
		await expect(caption).toHaveText("Green Woods");
		await expect(caption).toHaveCSS("animation-duration", "3s");
		await page.locator("canvas").click();
		await page.keyboard.press("Space");
		await page.waitForTimeout(80);
		await page.keyboard.press("Space");
		await expect
			.poll(() => observed.snapshot?.self.simulation.physics.freeFlight)
			.toBe(true);
		await landOnMapMarker(
			page,
			() => required(observed.snapshot).self.simulation.physics,
			// Bệ khác tại screen 4 cao hơn mốc Red Tree, không phải bệ Finish map 1.
			{ x: 328, y: -1200, width: 40 },
			physics.bodyWidth,
			physics.bodyHeight,
		);
		await expect
			.poll(() => observed.snapshot?.self.simulation.world.mapIntro?.level, {
				timeout: 5000,
				intervals: [30],
			})
			.toBe(2);
		await expect(caption).toHaveText("Red Tree");
		await expect(caption).toHaveCount(0, { timeout: 5000 });
		const intro = structuredClone(
			required(observed.snapshot).self.simulation.world.mapIntro,
		);
		const run = required(observed.snapshot).playId;
		await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await expect.poll(() => observed.snapshot?.self.paused).toBe(true);
		await page
			.getByRole("button", { name: "Save & Exit", exact: true })
			.click();
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible();
		await expect.poll(() => observed.snapshot?.playId).toBe(run);
		expect(required(observed.snapshot).self.simulation.world.mapIntro).toEqual(
			intro,
		);
		await expect(caption).toHaveCount(0);
		await page.locator("canvas").click();
		await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await page
			.getByRole("button", { name: "Save & Exit", exact: true })
			.click();
		page.once("dialog", (dialog) => dialog.accept());
		await newCommunity(page);
		await expect(caption).toHaveText("Green Woods");
		await expect.poll(() => observed.snapshot?.playId).not.toBe(run);
	} finally {
		await page.keyboard.up("ArrowUp");
		await page.keyboard.up("ArrowDown");
		await leaveOnline(page);
	}
});

test.skip(
	process.env.E2E_FLY_ONLINE !== "true",
	"Requires the backend/MySQL flight harness with Fly enabled",
);
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
	expect(best.maxProgress).toBeGreaterThan(40);
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
