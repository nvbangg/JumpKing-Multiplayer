import { expect, test } from "@playwright/test";

test("opens the home page", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "JumpKing", exact: true }),
	).toBeVisible();
	expect(errors).toEqual([]);
});
