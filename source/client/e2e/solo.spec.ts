import { expect, test } from "@playwright/test";
import { soloJumps } from "./support/solo";

test("Solo renders Main Babe, accepts charged jump and resumes from menu", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/play");
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await expect(page.locator("canvas")).toBeVisible();
	await page.screenshot({ path: info.outputPath("solo-main-babe.png") });
	if (
		await page.getByRole("button", { name: "Resume", exact: true }).isVisible()
	)
		await page.getByRole("button", { name: "Resume", exact: true }).click();
	await page.keyboard.down("Space");
	await expect.poll(() => soloJumps(page)).toBe(1);
	await page.keyboard.up("Space");
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Paused", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Paused", exact: true }),
	).toBeHidden();
	expect(errors).toEqual([]);
});
