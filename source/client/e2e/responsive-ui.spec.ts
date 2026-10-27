import { expect, test } from "@playwright/test";

const identity = {
	authenticated: true,
	account: { id: "1", username: "Bang_Bang", crown: "NONE", hasPassword: true },
};
const item = {
	id: "match-1",
	kind: "ROOM",
	status: "FINISHED",
	startedAt: "2026-10-25T12:00:00Z",
	endedAt: "2026-10-25T12:11:24Z",
	playTimeMs: 684000,
	finishTimeMs: 684000,
	jumps: 214,
	falls: 17,
	currentProgress: 464,
	maxProgress: 480,
	room: {
		mode: "RACE",
		mapId: 9,
		itemCooldownMinutes: null,
		roomCode: "001234",
		durationMs: 684000,
		rank: 1,
	},
};
for (const viewport of [
	{ width: 1672, height: 941 },
	{ width: 844, height: 390 },
	{ width: 844, height: 320 },
	{ width: 667, height: 375 },
	{ width: 568, height: 320 },
]) {
	test(`menu, records and room settings remain usable at ${viewport.width} × ${viewport.height}`, async ({
		browser,
	}, info) => {
		const mobile = viewport.width < 900;
		const context = await browser.newContext({
			viewport,
			hasTouch: mobile,
			isMobile: mobile,
		});
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.route("**/api/**", (route) => {
			const url = new URL(route.request().url());
			const responses: Record<string, unknown> = {
				"/api/auth/me": identity,
				"/api/profile/me": {
					total: {
						totalPlayTimeMs: 684000,
						bestFinishTimeMs: 684000,
						totalJumps: 214,
						totalFalls: 17,
						finishes: 1,
						matchesPlayed: 1,
						roomWins: 1,
					},
				},
				"/api/community/current": { run: { id: "saved-run" } },
				"/api/rooms": {
					rooms: [
						{
							roomId: "001234",
							mode: "RACE",
							mapId: 9,
							itemCooldownMinutes: 3,
							timeLimitMinutes: 5,
							playerCount: 3,
							capacity: 10,
						},
					],
				},
				"/api/history": {
					items: [
						{
							...item,
							id: url.searchParams.get("page") === "0" ? "match-1" : "match-2",
						},
					],
					page: Number(url.searchParams.get("page")),
					hasNext: url.searchParams.get("page") === "0",
				},
				"/api/history/ROOM/match-1": {
					...item,
					endReason: "FINISH",
					timeLimitMinutes: null,
					participants: [
						{
							runId: "player-1",
							username: "Bang_Bang",
							status: "FINISHED",
							rank: 1,
							currentProgress: 464,
							finishTimeMs: 684000,
						},
					],
				},
			};
			return route.fulfill({ json: responses[url.pathname] ?? {} });
		});
		const fits = async () => {
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			if (mobile) {
				expect(
					await page.evaluate(() => document.documentElement.scrollHeight),
				).toBeLessThanOrEqual(viewport.height);
				const back = page.getByRole("button", { name: "Back", exact: true });
				if (await back.count()) await expect(back).toBeInViewport();
			}
		};
		try {
			await page.goto("/");
			const stats = page.getByLabel("Total statistics");
			await expect(stats.locator(".data-row")).toHaveCount(6);
			await expect(stats.locator("dt")).toHaveText([
				"Total Play Time",
				"Best Finish Time",
				"Finishes",
				"Room Wins",
				"Jumps",
				"Falls",
			]);
			await expect(
				stats
					.locator(".data-row")
					.filter({ hasText: "Finishes" })
					.locator(".lucide-crown"),
			).toBeVisible();
			await expect(
				stats
					.locator(".data-row")
					.filter({ hasText: "Room Wins" })
					.locator(".lucide-flag"),
			).toBeVisible();
			await expect(
				stats
					.locator(".data-row")
					.filter({ hasText: "Room Wins" })
					.locator("dd"),
			).toHaveText("1");
			if (mobile) await expect(page.locator(".brand")).toBeHidden();
			else await expect(page.locator(".brand")).toBeVisible();
			if (mobile)
				expect(
					await page.evaluate(
						() => document.documentElement.scrollHeight <= innerHeight,
					),
				).toBe(true);
			await fits();
			await page.screenshot({ path: info.outputPath("home.png") });
			await page
				.getByRole("button", { name: "Bang_Bang", exact: true })
				.click();
			await fits();
			await page.screenshot({ path: info.outputPath("account.png") });
			await page
				.getByRole("button", { name: "Change Password", exact: true })
				.click();
			const password = page.getByLabel("New Password", { exact: true });
			await password.fill("a valid password");
			await page
				.getByRole("button", { name: "Show new password", exact: true })
				.click();
			await expect(password).toHaveAttribute("type", "text");
			await page
				.getByRole("button", { name: "Hide new password", exact: true })
				.click();
			await expect(password).toHaveAttribute("type", "password");
			const submit = page.getByRole("button", {
				name: "Change Password",
				exact: true,
			});
			await submit.evaluate((button) =>
				button.scrollIntoView({ block: "center" }),
			);
			await expect(submit).toBeInViewport({ ratio: 1 });
			const submitBox = await submit.boundingBox(),
				footerBox = await page.locator(".panel-actions").boundingBox();
			if (!submitBox || !footerBox) throw new Error("Password actions missing");
			expect(submitBox.y + submitBox.height).toBeLessThanOrEqual(footerBox.y);
			await fits();
			await page.screenshot({ path: info.outputPath("password.png") });
			await page.getByRole("button", { name: "Back", exact: true }).click();
			await page.getByRole("button", { name: "History", exact: true }).click();
			await expect(page.locator(".history-rows > button")).toHaveCount(1);
			const load = await page
				.getByRole("button", { name: "Load More", exact: true })
				.boundingBox();
			const back = await page
				.getByRole("button", { name: "Back", exact: true })
				.boundingBox();
			if (!load || !back) throw new Error("History footer is missing");
			expect(Math.abs(load.y - back.y)).toBeLessThanOrEqual(1);
			await fits();
			await page.screenshot({ path: info.outputPath("history.png") });
			await page
				.getByRole("button", { name: "Load More", exact: true })
				.click();
			await expect(page.locator(".history-rows > button")).toHaveCount(2);
			await page.locator(".history-rows > button").first().click();
			await expect(page.locator(".record-detail")).toContainText("Unlimited");
			await expect(page.locator(".record-detail")).not.toContainText("001234");
			await fits();
			await page.screenshot({ path: info.outputPath("history-detail.png") });
			await page.goto("/");
			await page
				.getByRole("button", { name: "Join Public Room", exact: true })
				.click();
			await expect(
				page.getByRole("table", { name: "Public rooms" }),
			).toContainText("3 min cooldown");
			await expect(
				page.getByRole("table", { name: "Public rooms" }),
			).toContainText("5 min");
			await expect(page.getByRole("searchbox")).toHaveCount(0);
			await expect(
				page.getByRole("columnheader", { name: "Status", exact: true }),
			).toHaveCount(0);
			await expect(
				page.getByRole("button", { name: "Join 001234", exact: true }),
			).toBeEnabled();
			await fits();
			await page.screenshot({ path: info.outputPath("public-rooms.png") });
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}
