import { expect, test } from "@playwright/test";
import { required } from "../src/required";
import { leaveOnline, newCommunity, registerOnline } from "./support/online";

test.skip(process.env.E2E_AUTH_ONLINE !== "true", "Requires backend/MySQL");
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
});
test.afterEach(async ({ page }) => {
	await leaveOnline(page);
});

test("Account totals come from committed Community data and survive reload", async ({
	page,
}) => {
	await registerOnline(page, "records");
	await newCommunity(page);
	await page.keyboard.down("Space");
	await page.waitForTimeout(220);
	await page.keyboard.up("Space");
	await page.waitForTimeout(900);
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Continue", exact: true }),
	).toBeVisible();
	const community = (
		await (await page.request.get("/api/community/current")).json()
	).run;
	const total = (await (await page.request.get("/api/profile/me")).json())
		.total;
	expect(total.totalJumps).toBe(1);
	expect(total.totalPlayTimeMs).toBe(community.elapsedTimeMs);
	await page.reload();
	const panel = page.getByLabel("Total statistics");
	await expect(
		panel
			.locator("div")
			.filter({ has: page.locator("dt", { hasText: /^Jumps$/ }) })
			.locator("dd"),
	).toHaveText("1");
	await expect(
		panel
			.locator("div")
			.filter({ has: page.locator("dt", { hasText: /^Best Finish Time$/ }) })
			.locator("dd"),
	).toHaveText("—");
});

test("History paginates owned Community results without depending on local storage", async ({
	page,
}) => {
	test.setTimeout(90000);
	await page.goto("/");
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await page
		.getByLabel("Username", { exact: true })
		.fill(required(process.env.E2E_HISTORY_USERNAME));
	await page
		.getByLabel("Password", { exact: true })
		.fill(required(process.env.E2E_HISTORY_PASSWORD));
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await expect(
		page.getByRole("button", {
			name: required(process.env.E2E_HISTORY_USERNAME),
			exact: true,
		}),
	).toBeVisible();
	await page.getByRole("button", { name: "History", exact: true }).click();
	const list = page.getByLabel("Game history");
	await expect(
		list.getByRole("button").filter({ hasText: "Abandoned" }),
	).toHaveCount(20);
	await list.getByRole("button", { name: "Load More", exact: true }).click();
	await expect(
		list.getByRole("button").filter({ hasText: "Abandoned" }),
	).toHaveCount(21);
	await expect(
		list.getByRole("button", { name: "Load More", exact: true }),
	).toBeHidden();
	await list
		.getByRole("button")
		.filter({ hasText: "Abandoned" })
		.first()
		.click();
	await expect(page.locator(".record-detail")).toContainText("Community");
	await page.evaluate(() => {
		indexedDB.open = () => {
			throw new DOMException("Blocked by test", "SecurityError");
		};
	});
	try {
		await page.getByRole("button", { name: "Back", exact: true }).click();
		await expect(
			page
				.getByLabel("Game history")
				.getByRole("button")
				.filter({ hasText: "Abandoned" }),
		).toHaveCount(20);
	} finally {
		await page.evaluate(() => Reflect.deleteProperty(indexedDB, "open"));
	}
});
