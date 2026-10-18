import { expect, test } from "@playwright/test";
import type { OnlineSnapshot } from "../src/game/netcode/OnlineRuntime";
import { required } from "../src/required";
import { leaveOnline } from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);
test.afterEach(async ({ page }) => {
	await leaveOnline(page);
});
test("NPC dialogue persists across Community Continue without Inventory", async ({
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
	await page.goto("/");
	await page.getByRole("button", { name: "Sign In", exact: true }).click();
	await page
		.getByLabel("Username", { exact: true })
		.fill(required(process.env.E2E_ADVENTURE_USERNAME));
	await page
		.getByLabel("Password", { exact: true })
		.fill(required(process.env.E2E_ADVENTURE_PASSWORD));
	await page.getByRole("button", { name: "Sign In", exact: true }).click();
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect
		.poll(
			() =>
				snapshots.at(-1)?.self.simulation.adventure.dialogue.old_man
					?.introduced,
		)
		.toBe(true);
	const talks = required(
		required(snapshots.at(-1)).self.simulation.adventure.dialogue.old_man,
	).talks;
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Inventory", exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "New Game", exact: true }),
	).toBeVisible();
	snapshots.length = 0;
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect
		.poll(
			() =>
				snapshots.at(-1)?.self.simulation.adventure.dialogue.old_man
					?.introduced,
		)
		.toBe(true);
	expect(
		required(
			required(snapshots.at(-1)).self.simulation.adventure.dialogue.old_man,
		).talks,
	).toBe(talks);
	expect(
		required(snapshots.at(-1)).self.simulation.adventure,
	).not.toHaveProperty("inventory");
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "New Game", exact: true }),
	).toBeVisible();
	expect(errors).toEqual([]);
});
