import { expect, test } from "@playwright/test";
import {
	leaveOnline,
	newCommunity,
	observeOnline,
	registerOnline,
} from "./support/online";

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
		await page
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await page.getByLabel("Username", { exact: true }).fill(name);
		await page
			.getByLabel("Password", { exact: true })
			.fill("A secure leaderboard test password");
		await page
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
		await page.getByRole("button", { name: "New Game", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Menu (Esc)", exact: true }),
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
		const panel = page.locator(".records-panel");
		await expect(panel).toHaveAttribute("open", "");
		await expect(page.locator(".players-panel")).toHaveAttribute("open", "");
		await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
		await expect(page.locator(".chat-panel > summary")).toHaveCount(0);
		for (const viewport of [
			{ width: 1280, height: 900 },
			{ width: 1280, height: 1080 },
			{ width: 1024, height: 768 },
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
			await records.scrollIntoViewIfNeeded();
			if (viewport.width <= 900)
				expect(
					await records.evaluate(
						(element) => element.scrollHeight > element.clientHeight,
					),
				).toBe(true);
			if (viewport.width <= 900)
				expect(
					await records.evaluate(
						(element) =>
							element.clientHeight <=
							(element.firstElementChild?.getBoundingClientRect().height ?? 0) *
								5 +
								1,
					),
				).toBe(true);
			await records.evaluate((element) => {
				element.scrollTop = element.scrollHeight;
			});
			await expect(records.getByRole("listitem").last()).toBeInViewport();
			const scrollTop = await records.evaluate((element) => element.scrollTop);
			const loaded = requests.length;
			await panel.locator("summary").click();
			await expect(records).toBeHidden();
			await panel.locator("summary").click();
			expect(await records.evaluate((element) => element.scrollTop)).toBe(
				scrollTop,
			);
			expect(requests).toHaveLength(loaded);
			await expect(
				page.getByRole("button", { name: "Refresh", exact: true }),
			).toBeInViewport();
			const stage = await page.locator(".game-stage").boundingBox(),
				sidebar = await page.locator(".game-sidebar").boundingBox(),
				players = await page.locator(".players-panel").boundingBox(),
				board = await panel.boundingBox(),
				chat = await page.locator(".game-chat").boundingBox();
			if (!stage || !sidebar || !players || !board || !chat)
				throw new Error("Game layout is missing");
			if (viewport.width > 900) {
				expect(stage.x + stage.width).toBeLessThanOrEqual(sidebar.x);
				expect(chat.x + chat.width).toBeLessThanOrEqual(stage.x);
				expect(stage.x + stage.width / 2).toBeCloseTo(viewport.width / 2, 0);
			} else {
				expect(stage.y + stage.height).toBeLessThanOrEqual(sidebar.y);
				expect(players.y).toBeCloseTo(board.y, 0);
				expect(players.x + players.width).toBeLessThanOrEqual(board.x);
				expect(chat.y).toBeGreaterThanOrEqual(
					Math.max(players.y + players.height, board.y + board.height),
				);
			}
			const canvas = await page.locator("canvas").boundingBox();
			expect(canvas && canvas.width / canvas.height).toBeCloseTo(4 / 3, 2);
			if (viewport.width > 900) {
				expect(canvas?.width).toBeCloseTo(
					viewport.width >= 1200 ? 720 : 480,
					0,
				);
				expect(canvas?.height).toBeCloseTo(
					viewport.width >= 1200 ? 540 : 360,
					0,
				);
			}
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: info.outputPath(
					`community-${viewport.width}-${viewport.height}.png`,
				),
				fullPage: true,
			});
		}
		await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await page
			.getByRole("button", { name: "Save & Exit", exact: true })
			.click();
		expect(errors).toEqual([]);
	} finally {
		await leaveOnline(page);
	}
});

test("mobile panels preserve drafts and chat stays available while paused", async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	try {
		const observed = observeOnline(page);
		await registerOnline(page, "panels");
		await newCommunity(page);
		const message = page.getByLabel("Message", { exact: true });
		await expect(message).toBeVisible();
		await message.fill("Unsent draft");
		await page.locator("canvas").focus();
		await page.keyboard.press("Enter");
		await expect(message).toBeFocused();
		await expect(message).toHaveValue("Unsent draft");
		await page.keyboard.press("Escape");
		await expect(message).toBeVisible();
		await expect(message).toHaveValue("Unsent draft");
		for (const viewport of [
			{ width: 844, height: 390 },
			{ width: 568, height: 320 },
		]) {
			await page.setViewportSize(viewport);
			const records = page.locator(".records-panel");
			await records.locator("summary").tap();
			await expect(records.getByRole("list")).toBeHidden();
			await expect(page.locator(".players-panel summary")).toBeVisible();
			await records.locator("summary").tap();
			await expect(records.getByRole("list")).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Refresh", exact: true }),
			).toBeVisible();
			await expect(message).toBeVisible();
			await expect(message).toHaveValue("Unsent draft");
			await page.screenshot({
				path: info.outputPath(`panels-${viewport.width}.png`),
			});
		}
		const players = page.locator(".players-panel"),
			summary = players.locator("summary"),
			jumps = observed.snapshot?.self.simulation.physics.jumps;
		await summary.focus();
		await page.keyboard.press("Space");
		await expect(players.getByRole("list")).toBeHidden();
		await page.keyboard.press("Enter");
		await expect(players.getByRole("list")).toBeVisible();
		expect(observed.snapshot?.self.simulation.physics.jumps).toBe(jumps);
		expect(observed.snapshot?.self.simulation.physics.charge).toBe(0);
		await page.keyboard.press("Escape");
		const menu = page.getByRole("region", { name: "Game menu", exact: true });
		await expect(menu).toBeVisible();
		await expect(message).toBeVisible();
		await message.fill("Draft while paused");
		await expect(message).toHaveValue("Draft while paused");
		await menu.scrollIntoViewIfNeeded();
		expect(
			await menu.evaluate((element) => {
				const box = element.getBoundingClientRect();
				return element.contains(
					document.elementFromPoint(
						box.x + box.width / 2,
						box.y + box.height / 2,
					),
				);
			}),
		).toBe(true);
		await expect(page.getByText("Saved", { exact: true })).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Open Chat", exact: true }),
		).toHaveCount(0);
		await page.getByRole("button", { name: "Resume", exact: true }).click();
	} finally {
		await leaveOnline(page);
	}
});
