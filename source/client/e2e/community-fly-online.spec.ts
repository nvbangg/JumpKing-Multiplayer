import { expect, test } from "@playwright/test";
import type { OnlineSnapshot } from "../src/game/netcode/OnlineRuntime";

test.skip(
	process.env.E2E_FLY_ONLINE !== "true",
	"Requires the local-profile backend/MySQL flight harness",
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
	const name = "flight_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
	await page.goto("/");
	await page
		.getByRole("button", { name: "Create Account", exact: true })
		.click();
	await page.getByLabel("Username", { exact: true }).fill(name);
	await page
		.getByLabel("Password", { exact: true })
		.fill("A secure flight browser password");
	await page
		.getByRole("button", { name: "Create Account", exact: true })
		.click();
	await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
	await page
		.getByRole("button", { name: "Community Tower", exact: true })
		.click();
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	await page.keyboard.press("Space");
	await page.waitForTimeout(80);
	await page.keyboard.press("Space");
	await expect
		.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
		.toBe(true);
	const initialY = snapshots.at(-1)!.self.simulation.physics.y,
		run = snapshots.at(-1)!.playId;
	await page.waitForTimeout(400);
	await page.keyboard.down("Space");
	await page.waitForTimeout(250);
	await page.keyboard.up("Space");
	await page.waitForTimeout(400);
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
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "New Solo Game", exact: true }),
	).toBeVisible();
	const best = (
		await (await page.request.get("/api/leaderboard")).json()
	).entries.find((entry: { username: string }) => entry.username === name);
	expect(best.id).toBe(run);
	expect(best.maxProgress).toBeGreaterThan(40);
	await page
		.getByRole("button", { name: "Community Tower", exact: true })
		.click();
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await expect.poll(() => snapshots.at(-1)?.playId).toBe(run);
	await expect
		.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
		.toBe(true);
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	await page.keyboard.press("Space");
	await page.waitForTimeout(80);
	await page.keyboard.press("Space");
	await expect
		.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
		.toBe(false);
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "New Solo Game", exact: true }),
	).toBeVisible();
	expect(errors).toEqual([]);
});
