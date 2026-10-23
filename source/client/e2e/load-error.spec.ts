import { expect, test } from "@playwright/test";

test("asset errors offer a manual retry only at home and survive menu navigation", async ({
	page,
}) => {
	let navigations = 0;
	page.on("request", (request) => {
		if (request.isNavigationRequest() && request.frame() === page.mainFrame())
			navigations++;
	});
	await page.goto("/");
	await expect(page.getByRole("status", { name: "Game files" })).toHaveCount(0);
	await page.getByRole("button", { name: "Options", exact: true }).click();
	const prevented = await page.evaluate(
		() =>
			!window.dispatchEvent(
				new Event("vite:preloadError", { cancelable: true }),
			),
	);
	expect(prevented).toBe(true);
	await expect(page.getByRole("status", { name: "Game files" })).toContainText(
		"Return to the main menu to reload",
	);
	await expect(
		page.getByRole("button", { name: "Reload", exact: true }),
	).toHaveCount(0);
	expect(navigations).toBe(1);
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await page.getByRole("button", { name: "Reload", exact: true }).click();
	await expect.poll(() => navigations).toBe(2);
	await expect(page.getByRole("status", { name: "Game files" })).toHaveCount(0);
});
