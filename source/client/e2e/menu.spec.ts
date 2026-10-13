import { expect, test } from "@playwright/test";

test("home keeps the required menu and separate account forms", async ({
	page,
}, info) => {
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "Continue Solo", exact: true }),
	).toBeHidden();
	await expect(
		page.getByRole("button", { name: "Leaderboard", exact: true }),
	).toBeHidden();
	await page.getByRole("button", { name: "Sign In", exact: true }).click();
	await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
	await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
	await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
	await page
		.getByRole("button", { name: "New here? Create Account", exact: true })
		.click();
	await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await page
		.getByRole("button", { name: "Community Tower", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Leaderboard", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await expect(page.getByLabel("Total statistics")).toBeVisible();
	await page.screenshot({
		path: info.outputPath("menu-desktop.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(
		page.getByRole("button", { name: "New Solo Game", exact: true }),
	).toBeVisible();
	const horizontal = await page.evaluate(
		() => document.documentElement.scrollWidth > innerWidth,
	);
	expect(horizontal).toBe(false);
	await page.screenshot({
		path: info.outputPath("menu-mobile.png"),
		fullPage: true,
	});
});

test("keyboard navigation restores focus and offline actions report real errors", async ({
	page,
}) => {
	await page.route("**/api/**", (route) => route.abort("connectionrefused"));
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "New Solo Game", exact: true }),
	).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(
		page.getByRole("button", { name: "Room", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByText("Sign in to play online.")).toBeVisible();
	await page.getByRole("button", { name: "Sign In", exact: true }).click();
	await page.getByLabel("Username", { exact: true }).fill("Player");
	await page.getByLabel("Password", { exact: true }).fill("A valid password");
	await page.getByRole("button", { name: "Sign In", exact: true }).click();
	await expect(page.getByRole("alert")).toHaveText(
		"Unable to connect to the server",
	);
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Room", exact: true }),
	).toBeFocused();
});
