import { expect, test } from "@playwright/test";

for (const mobile of [false, true]) {
	test(`New Game confirms inside the page (${mobile ? "mobile landscape" : "desktop"})`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			viewport: mobile
				? { width: 844, height: 390 }
				: { width: 1280, height: 720 },
			isMobile: mobile,
			hasTouch: mobile,
		});
		const page = await context.newPage();
		const commands: unknown[] = [];
		const nativeDialogs: string[] = [];
		page.on("dialog", (dialog) => {
			nativeDialogs.push(dialog.message());
			void dialog.dismiss();
		});
		await page.route("**/api/**", async (route) => {
			const path = new URL(route.request().url()).pathname;
			if (path === "/api/auth/me")
				await route.fulfill({
					json: {
						authenticated: true,
						account: {
							id: "1",
							username: "tester",
							crown: "NONE",
							hasPassword: true,
						},
					},
				});
			else if (path === "/api/community/current")
				await route.fulfill({ json: { run: { id: "existing-run" } } });
			else if (path === "/api/profile/me")
				await route.fulfill({
					json: {
						total: {
							totalPlayTimeMs: 1000,
							totalJumps: 0,
							totalFalls: 0,
							finishes: 0,
							matchesPlayed: 0,
							roomWins: 0,
							bestFinishTimeMs: null,
						},
					},
				});
			else await route.fulfill({ json: {} });
		});
		await page.routeWebSocket("**/ws/game", (socket) => {
			socket.onMessage((raw) => {
				const message = JSON.parse(String(raw));
				if (message.type === "JOIN_COMMUNITY") {
					commands.push(message.payload);
					socket.send(
						JSON.stringify({
							v: 1,
							type: "ERROR",
							requestId: message.requestId,
							payload: { code: "CONFLICT", message: "Test command received" },
						}),
					);
				}
			});
		});
		try {
			await page.goto("/");
			const newGame = page.getByRole("button", {
				name: "New Game",
				exact: true,
			});
			await expect(newGame).toBeEnabled();
			await newGame.click();
			const dialog = page.getByRole("dialog", {
				name: "Replace your unfinished game?",
			});
			await expect(dialog).toBeVisible();
			await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
			await expect(dialog).toBeHidden();
			expect(commands).toEqual([]);
			await newGame.click();
			await page.keyboard.press("Escape");
			await expect(dialog).toBeHidden();
			expect(commands).toEqual([]);
			await newGame.click();
			await dialog
				.getByRole("button", { name: "Confirm", exact: true })
				.click();
			await expect
				.poll(() => commands)
				.toEqual([{ newRun: true, expectedRunId: "existing-run" }]);
			expect(nativeDialogs).toEqual([]);
			expect(await page.evaluate(() => innerWidth > innerHeight)).toBe(true);
		} finally {
			await context.close();
		}
	});
}
