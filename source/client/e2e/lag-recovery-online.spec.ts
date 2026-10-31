import { expect, test } from "@playwright/test";
import {
	createRoom,
	leaveOnline,
	newCommunity,
	observeOnline,
	registerOnline,
	startRoom,
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
				await page.setViewportSize({ width: 844, height: 390 });
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
				).not.toHaveText("00:00 s", { timeout: 10000 });
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

for (const kind of ["COMMUNITY", "ROOM"] as const) {
	test(`${kind} hides short interruptions, preserves pause and requires manual recovery after 3 seconds`, async ({
		page,
	}, info) => {
		test.setTimeout(60_000);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		let blocked = false;
		let release: (() => void) | undefined;
		await page.routeWebSocket("**/ws/game", (client) => {
			const server = client.connectToServer();
			client.onMessage((data) => {
				if (blocked && JSON.parse(data.toString()).type === "RECONNECT")
					release = () => server.send(data);
				else server.send(data);
			});
		});
		const observed = observeOnline(page);
		await registerOnline(page, "grace");
		await page.evaluate(async () => {
			const path = "/src/network/GameSocket.ts";
			const { GameSocket } = await import(path);
			const original = GameSocket.prototype.input;
			GameSocket.prototype.input = function (
				type: "PLAYER_INPUT" | "CANCEL_INPUT",
				payload: Record<string, unknown>,
			) {
				Object.assign(window, {
					interruptGame: () => this.fail("Test temporary interruption"),
				});
				original.call(this, type, payload);
			};
		});
		if (kind === "COMMUNITY") await newCommunity(page);
		else {
			await createRoom(page);
			await startRoom(page, page);
		}
		const disconnected = page.getByRole("heading", {
			name: "Disconnected",
			exact: true,
		});
		const menu = page.getByRole("region", { name: "Game menu", exact: true });
		const interrupt = () =>
			page.evaluate(() => {
				(window as unknown as { interruptGame: () => void }).interruptGame();
				return Date.now();
			});
		await expect
			.poll(() => observed.snapshot?.self.lastProcessedInputSeq ?? 0)
			.toBeGreaterThan(0);
		const generation = observed.snapshot?.generation ?? 0;
		blocked = true;
		await interrupt();
		await expect.poll(() => Boolean(release)).toBe(true);
		await page.waitForTimeout(1000);
		await expect(menu).toHaveCount(0);
		release?.();
		blocked = false;
		await expect
			.poll(() => observed.snapshot?.generation ?? 0)
			.toBeGreaterThan(generation);
		await expect.poll(() => observed.snapshot?.self.paused).toBe(false);
		await expect
			.poll(() => observed.snapshot?.self.lastProcessedInputSeq ?? 0)
			.toBeGreaterThan(0);
		await expect(menu).toHaveCount(0);
		const message = page.getByRole("textbox", { name: "Message", exact: true });
		await message.fill("Draft survives brief interruption");
		const chatGeneration = observed.snapshot?.generation ?? 0;
		await interrupt();
		await expect
			.poll(() => observed.snapshot?.generation ?? 0)
			.toBeGreaterThan(chatGeneration);
		await expect.poll(() => observed.snapshot?.self.paused).toBe(false);
		await expect(message).toHaveValue("Draft survives brief interruption");
		await expect(message).toBeFocused();
		await expect(menu).toHaveCount(0);
		await message.press("Escape");
		await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await expect(menu).toBeVisible();
		const pausedGeneration = observed.snapshot?.generation ?? 0;
		await interrupt();
		await expect
			.poll(() => observed.snapshot?.generation ?? 0)
			.toBeGreaterThan(pausedGeneration);
		await expect(menu).toBeVisible();
		await expect(disconnected).toHaveCount(0);
		await page.getByRole("button", { name: "Resume", exact: true }).click();
		await expect
			.poll(() => observed.snapshot?.self.lastProcessedInputSeq ?? 0)
			.toBeGreaterThan(0);
		blocked = true;
		release = undefined;
		const interruptedAt = await interrupt();
		await page.waitForTimeout(2200);
		await expect(menu).toHaveCount(0);
		await expect(disconnected).toBeVisible();
		expect(
			(await page.evaluate(() => Date.now())) - interruptedAt,
		).toBeGreaterThanOrEqual(3000);
		await expect(page).toHaveTitle(/JumpKing/);
		await expect(page.locator("canvas")).toBeVisible();
		await expect(page.locator("vite-error-overlay")).toHaveCount(0);
		await page.screenshot({ path: info.outputPath(`${kind}-reconnect.png`) });
		blocked = false;
		await page.getByRole("button", { name: "Reconnect", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Resume", exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Resume", exact: true }).click();
		await expect(menu).toHaveCount(0);
		await expect
			.poll(() => observed.snapshot?.self.lastProcessedInputSeq ?? 0)
			.toBeGreaterThan(0);
		expect(errors).toEqual([]);
	});
}
