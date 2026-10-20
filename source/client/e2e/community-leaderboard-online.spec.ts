import { expect, test } from "@playwright/test";
import { leaveOnline, newCommunity, registerOnline } from "./support/online";

test.use({ isMobile: true, hasTouch: true });

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);
test("Community records stay visible, scroll on mobile and load only on entry or Refresh", async ({
	page,
}, info) => {
	test.setTimeout(60_000);
	const requests: number[] = [],
		errors: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/api/leaderboard")
			requests.push(Date.now());
	});
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		const name = `board_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
		await page.addInitScript(() =>
			localStorage.setItem(
				"jumpking.options",
				JSON.stringify({ sound: false }),
			),
		);
		// Fixture chỉ cho bố cục danh sách dài; đăng nhập và Community dùng backend thật.
		await page.route("**/api/leaderboard?limit=*", (route) =>
			route.fulfill({
				json: {
					entries: Array.from({ length: 10 }, (_, index) => ({
						id: String(index),
						rank: index + 1,
						username: `player_with_a_long_name_${index}`,
						status: "ACTIVE",
						currentProgress: 100,
						maxProgress: 100,
						elapsedTimeMs: 1000,
						peakReachedTimeMs: 1000,
						finishTimeMs: null,
					})),
				},
			}),
		);
		await page.goto("/");
		await page.getByRole("button", { name: "Sign In", exact: true }).click();
		await page.getByLabel("Username", { exact: true }).fill(name);
		await page
			.getByLabel("Password", { exact: true })
			.fill("A secure leaderboard test password");
		await page.getByRole("button", { name: "Sign In", exact: true }).click();
		await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
		await page.getByRole("button", { name: "New Game", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Menu", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByRole("list", { name: "Community records" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Refresh", exact: true }),
		).toBeEnabled();
		// StrictMode có thể chạy effect mount hai lần trong dev; không được polling sau đó.
		const initialRequests = requests.length;
		expect(initialRequests).toBeGreaterThan(0);
		await page.screenshot({ path: info.outputPath("community-boards.png") });
		await page.waitForTimeout(10500);
		expect(requests).toHaveLength(initialRequests);
		await page.getByRole("button", { name: "Refresh", exact: true }).click();
		await expect.poll(() => requests.length).toBe(initialRequests + 1);
		await expect(
			page.locator("summary").filter({ hasText: /^Leaderboard$/ }),
		).toHaveCount(0);
		for (const viewport of [
			{ width: 390, height: 844 },
			{ width: 844, height: 390 },
		]) {
			await page.setViewportSize(viewport);
			if (
				await page
					.getByRole("button", { name: "Resume", exact: true })
					.isVisible()
			)
				await page.getByRole("button", { name: "Resume", exact: true }).click();
			const records = page.getByRole("list", { name: "Community records" });
			await expect(records.getByRole("listitem")).toHaveCount(10);
			expect(
				await records.evaluate(
					(element) => element.scrollHeight > element.clientHeight,
				),
			).toBe(true);
			await records.evaluate((element) => {
				element.scrollTop = element.scrollHeight;
			});
			await expect(records.getByRole("listitem").last()).toBeInViewport();
			const scrollTop = await records.evaluate((element) => element.scrollTop);
			const loaded = requests.length;
			await page
				.getByRole("button", { name: "Collapse leaderboard", exact: true })
				.tap();
			await expect(records).toBeHidden();
			await page
				.getByRole("button", { name: "Show leaderboard", exact: true })
				.tap();
			expect(await records.evaluate((element) => element.scrollTop)).toBe(
				scrollTop,
			);
			expect(requests).toHaveLength(loaded);
			await expect(
				page.getByRole("button", { name: "Refresh", exact: true }),
			).toBeInViewport();
			const panels = await page.locator(".in-game-panels").boundingBox();
			expect(panels && panels.y + panels.height <= viewport.height - 84).toBe(
				true,
			);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: info.outputPath(`community-${viewport.width}.png`),
			});
		}
		await page.getByRole("button", { name: "Menu", exact: true }).click();
		await page
			.getByRole("button", { name: "Save & Exit", exact: true })
			.click();
		expect(errors).toEqual([]);
	} finally {
		await leaveOnline(page);
	}
});

test("mobile panels preserve drafts and keyboard chat can be collapsed again", async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	try {
		await registerOnline(page, "panels");
		await newCommunity(page);
		const chat = page.getByRole("region", { name: "Room chat", exact: true });
		const message = page.getByLabel("Message", { exact: true });
		await message.fill("Unsent draft");
		await page
			.getByRole("button", { name: "Collapse chat", exact: true })
			.tap();
		await expect(chat).toBeHidden();
		await page.locator("canvas").focus();
		await page.keyboard.press("Enter");
		await expect(message).toBeFocused();
		await expect(message).toHaveValue("Unsent draft");
		await page
			.getByRole("button", { name: "Collapse chat", exact: true })
			.tap();
		await expect(chat).toBeHidden();
		await page.getByRole("button", { name: "Show chat", exact: true }).tap();
		await expect(message).toHaveValue("Unsent draft");
		for (const viewport of [
			{ width: 844, height: 390 },
			{ width: 568, height: 320 },
		]) {
			await page.setViewportSize(viewport);
			const records = page.getByRole("region", {
				name: "Community leaderboard",
				exact: true,
			});
			await page
				.getByRole("button", { name: "Collapse leaderboard", exact: true })
				.tap();
			await expect(records).toBeHidden();
			await expect(
				page.getByRole("heading", { name: "Players" }),
			).toBeVisible();
			await page
				.getByRole("button", { name: "Show leaderboard", exact: true })
				.tap();
			await expect(records).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Refresh", exact: true }),
			).toBeInViewport();
			await page.screenshot({
				path: info.outputPath(`panels-${viewport.width}.png`),
			});
		}
	} finally {
		await leaveOnline(page);
	}
});
