import { expect, type Page, test } from "@playwright/test";
import type { SoloRun } from "../src/features/solo/storage";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
});
async function register(page: Page) {
	const username =
		"records_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
	await page.goto("/");
	await page
		.getByRole("button", { name: "Create Account", exact: true })
		.click();
	await page.getByLabel("Username", { exact: true }).fill(username);
	await page
		.getByLabel("Password", { exact: true })
		.fill("A secure records test password");
	await page
		.getByRole("button", { name: "Create Account", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: username, exact: true }),
	).toBeVisible();
	return (await (await page.request.get("/api/auth/me")).json()).account
		.id as string;
}

test("Account totals combine committed Community and Solo once and survive reload", async ({
	page,
}) => {
	const id = await register(page);
	await page
		.getByRole("button", { name: "Community Tower", exact: true })
		.click();
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible({ timeout: 15_000 });
	await page.keyboard.down("Space");
	await page.waitForTimeout(220);
	await page.keyboard.up("Space");
	await page.waitForTimeout(900);
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "New Solo Game", exact: true }),
	).toBeVisible();
	const community = (
		await (await page.request.get("/api/community/current")).json()
	).run;
	const prior = (await (await page.request.get("/api/profile/me")).json())
		.total;
	expect(prior.totalJumps).toBe(1);
	expect(prior.totalPlayTimeMs).toBe(community.elapsedTimeMs);
	await page
		.getByRole("button", { name: "New Solo Game", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await page.keyboard.down("Space");
	await page.waitForTimeout(220);
	await page.keyboard.up("Space");
	await page.waitForTimeout(900);
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Continue Solo", exact: true }),
	).toBeVisible();
	const local: SoloRun[] = await page.evaluate(async (owner) => {
		const path = "/src/features/solo/storage.ts";
		const { soloRuns } = await import(path);
		return soloRuns(location.origin + ":account:" + owner);
	}, id);
	expect(local).toHaveLength(1);
	expect(local[0]!.jumps).toBe(1);
	await expect
		.poll(
			async () =>
				(await (await page.request.get("/api/profile/me")).json()).total
					.totalJumps,
		)
		.toBe(2);
	const total = (await (await page.request.get("/api/profile/me")).json())
		.total;
	const floor =
		community.elapsedTimeMs + Math.floor((local[0]!.playTicks * 1000) / 60);
	expect(total.totalPlayTimeMs).toBeGreaterThanOrEqual(floor);
	expect(total.totalPlayTimeMs).toBeLessThanOrEqual(floor + 1);
	await page.reload();
	const panel = page.getByLabel("Total statistics");
	await expect(
		panel
			.locator("div")
			.filter({ has: page.locator("dt", { hasText: /^Jumps$/ }) })
			.locator("dd"),
	).toHaveText("2");
	await expect(
		panel
			.locator("div")
			.filter({ has: page.locator("dt", { hasText: /^Total Play Time$/ }) })
			.locator("dd"),
	).toHaveText(
		"00:" + String(Math.floor(total.totalPlayTimeMs / 1000)).padStart(2, "0"),
	);
	await expect(
		panel
			.locator("div")
			.filter({ has: page.locator("dt", { hasText: /^Best Finish Time$/ }) })
			.locator("dd"),
	).toHaveText("—");
});

test("History loads further server pages and fetches an owned terminal detail", async ({
	page,
}) => {
	const owner = await register(page);
	await page.evaluate(async (account) => {
		const path = "/src/network/api.ts",
			{ api } = await import(path);
		for (let index = 0; index < 21; index++)
			await api(
				"/solo/runs/" + crypto.randomUUID(),
				"PUT",
				{
					revision: 1,
					status: "ABANDONED",
					playTicks: 60,
					jumps: index,
					falls: 0,
					currentProgress: 0,
					maxProgress: 100,
					peakReachedTicks: 30,
					finishTicks: null,
					startedAt: "2026-01-01T00:00:00.000Z",
					endedAt: new Date(Date.UTC(2026, 0, 1, 0, index + 1)).toISOString(),
				},
				account,
			);
	}, owner);
	await page.getByRole("button", { name: "History", exact: true }).click();
	const list = page.getByLabel("Game history");
	await expect(
		list.getByRole("button").filter({ hasText: "ABANDONED" }),
	).toHaveCount(20);
	await list.getByRole("button", { name: "Load More", exact: true }).click();
	await expect(
		list.getByRole("button").filter({ hasText: "ABANDONED" }),
	).toHaveCount(21);
	await expect(
		list.getByRole("button", { name: "Load More", exact: true }),
	).toBeHidden();
	const request = page.waitForResponse(
		(response) =>
			response.url().includes("/api/history/SOLO/") &&
			response.status() === 200,
	);
	await list
		.getByRole("button")
		.filter({ hasText: "ABANDONED" })
		.first()
		.click();
	await request;
	await expect(page.locator(".record-detail")).toContainText("SOLO");
	await expect(page.locator(".record-detail")).toContainText("100 px");
	await page.evaluate(() => {
		indexedDB.open = () => {
			throw new DOMException(
				"Blocked for storage regression test",
				"SecurityError",
			);
		};
	});
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await expect(
		page
			.getByLabel("Game history")
			.getByRole("button")
			.filter({ hasText: "ABANDONED" }),
	).toHaveCount(20);
	await expect(
		page
			.getByLabel("Game history")
			.getByRole("button", { name: "Load More", exact: true }),
	).toBeEnabled();
});
