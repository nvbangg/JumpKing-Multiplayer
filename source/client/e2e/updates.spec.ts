import { expect, test } from "@playwright/test";

test("new release is offered without automatic reload and reloads only on request at home", async ({
	page,
}) => {
	let navigations = 0;
	page.on("request", (request) => {
		if (request.isNavigationRequest() && request.frame() === page.mainFrame())
			navigations++;
	});
	await page.route("**/version.json", (route) =>
		route.fulfill({ json: { version: "different-release" } }),
	);
	await page.goto("/");
	await expect(
		page.getByRole("status", { name: "Website update" }),
	).toContainText("New version available");
	expect(navigations).toBe(1);
	await page.getByRole("button", { name: "Options", exact: true }).click();
	await expect(page.getByRole("button", { name: "Update now" })).toHaveCount(0);
	await expect(
		page.getByRole("status", { name: "Website update" }),
	).toContainText("Return to the main menu");
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await page.getByRole("button", { name: "Update now", exact: true }).click();
	await expect.poll(() => navigations).toBe(2);
});

test("failed release request does not show a false update and preload errors offer a manual retry", async ({
	page,
}) => {
	await page.route("**/version.json", (route) => route.abort());
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "New Game", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("status", { name: "Website update" }),
	).toHaveCount(0);
	const prevented = await page.evaluate(
		() =>
			!window.dispatchEvent(
				new Event("vite:preloadError", { cancelable: true }),
			),
	);
	expect(prevented).toBe(true);
	await expect(
		page.getByRole("button", { name: "Reload", exact: true }),
	).toBeVisible();
});
