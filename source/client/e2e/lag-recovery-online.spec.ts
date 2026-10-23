import { expect, test } from "@playwright/test";
import {
	createRoom,
	leaveOnline,
	newCommunity,
	registerOnline,
} from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);

test.afterEach(async ({ page }) => {
	await page.evaluate(() => {
		(window as unknown as { restoreLag?: () => void }).restoreLag?.();
	});
	await leaveOnline(page);
});

for (const kind of ["COMMUNITY", "ROOM"] as const) {
	for (const action of ["exit", "reconnect"] as const) {
		test(`${kind} input backlog allows ${action} without reloading or signing in again`, async ({
			page,
		}) => {
			if (kind === "COMMUNITY" && action === "reconnect") {
				await page.setViewportSize({ width: 390, height: 844 });
			}
			const name = await registerOnline(page, "lag");
			if (kind === "COMMUNITY") await newCommunity(page);
			else {
				await createRoom(page);
				await page.getByRole("button", { name: "Start", exact: true }).click();
				await expect(
					page.getByRole("button", { name: "Menu (Esc)", exact: true }),
				).toBeVisible({ timeout: 30000 });
				await expect(
					page.getByLabel("Play time", { exact: true }),
				).not.toHaveText("00:00", { timeout: 10000 });
				await page.locator("canvas").click();
			}
			if (
				await page
					.getByRole("button", { name: "Resume", exact: true })
					.isVisible()
			) {
				await page.getByRole("button", { name: "Resume", exact: true }).click();
			}
			await page.evaluate(async () => {
				const path = "/src/network/GameSocket.ts";
				const { GameSocket } = await import(path);
				const original = GameSocket.prototype.input;
				// Chặn input mới để ACK ngừng tiến, vẫn giữ control và snapshot server thật.
				GameSocket.prototype.input = function (
					type: string,
					payload: Record<string, unknown>,
				) {
					if (type !== "PLAYER_INPUT") original.call(this, type, payload);
				};
				Object.assign(window, {
					restoreLag: () => {
						GameSocket.prototype.input = original;
					},
				});
			});
			await expect(
				page.getByRole("heading", { name: "Disconnected", exact: true }),
			).toBeVisible({ timeout: 15000 });
			await expect(page.getByRole("alert")).toContainText("too far behind");
			await expect(
				page.getByRole("button", { name: "Resume", exact: true }),
			).toHaveCount(0);
			await page.evaluate(() =>
				(window as unknown as { restoreLag: () => void }).restoreLag(),
			);
			if (action === "exit") {
				// Không có server để xác nhận Leave vẫn phải thoát được ngay.
				await page.route("**/api/**", (route) => route.abort());
				await page
					.getByRole("button", { name: "Back to Menu", exact: true })
					.click();
				await expect(
					page.getByRole("button", { name: "New Game", exact: true }),
				).toBeVisible();
				await expect(page.locator("canvas")).toHaveCount(0);
				await expect(
					page.getByText(
						kind === "COMMUNITY"
							? /Latest save could not be confirmed/
							: /departure could not be confirmed/,
					),
				).toBeVisible();
				await expect(
					page.getByRole("button", { name, exact: true }),
				).toBeVisible();
				await page.unroute("**/api/**");
			} else {
				await page
					.getByRole("button", { name: "Reconnect", exact: true })
					.click();
				await expect(
					page.getByRole("button", { name: "Resume", exact: true }),
				).toBeVisible();
				await page.getByRole("button", { name: "Resume", exact: true }).click();
				await expect(
					page.getByRole("button", { name: "Menu (Esc)", exact: true }),
				).toBeVisible();
				await expect(
					page.getByRole("heading", { name: "Disconnected", exact: true }),
				).toHaveCount(0);
				await page
					.getByRole("button", { name: "Menu (Esc)", exact: true })
					.click();
				await page
					.getByRole("button", {
						name: kind === "COMMUNITY" ? "Save & Exit" : "Leave Room",
						exact: true,
					})
					.click();
				await expect(
					page.getByRole("button", { name: "New Game", exact: true }),
				).toBeVisible();
				if (kind === "COMMUNITY")
					await expect(
						page.getByRole("button", { name: "Continue", exact: true }),
					).toBeVisible();
			}
		});
	}
}
