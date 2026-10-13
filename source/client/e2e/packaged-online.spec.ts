import { expect, test } from "@playwright/test";
import {
	createRoom,
	joinRoom,
	observeOnline,
	registerOnline,
	startRoom,
} from "./support/online";

test.skip(
	process.env.E2E_PACKAGED !== "true",
	"Requires the packaged web JAR and isolated MySQL",
);
test("the production web JAR supports Community save and a two-player Room through its own origin", async ({
	browser,
}) => {
	test.setTimeout(60_000);
	const account = await browser.newContext(),
		guest = await browser.newContext();
	try {
		for (const context of [account, guest])
			await context.addInitScript(() =>
				localStorage.setItem(
					"jumpking.options",
					JSON.stringify({ sound: false }),
				),
			);
		const a = await account.newPage(),
			b = await guest.newPage();
		const observed = observeOnline(a);
		await registerOnline(a, "jar_host");
		const peerName = await registerOnline(b, "jar_peer");
		await a
			.getByRole("button", { name: "Community Tower", exact: true })
			.click();
		await a.getByRole("button", { name: "New Game", exact: true }).click();
		await expect(
			a.getByRole("button", { name: "Menu", exact: true }),
		).toBeVisible();
		await a.getByRole("button", { name: "Menu", exact: true }).click();
		await a.getByRole("button", { name: "Save & Exit", exact: true }).click();
		await expect(
			a.getByRole("button", { name: "New Solo Game", exact: true }),
		).toBeVisible();
		await a
			.getByRole("button", { name: "Community Tower", exact: true })
			.click();
		await expect(
			a.getByRole("button", { name: "Continue", exact: true }),
		).toBeVisible();
		await a.getByRole("button", { name: "Back", exact: true }).click();
		const code = await createRoom(a);
		await joinRoom(b, code);
		await startRoom(a, b);
		await a.keyboard.down("Space");
		await a.waitForTimeout(220);
		await a.keyboard.up("Space");
		await expect
			.poll(() => observed.snapshot?.self.simulation.physics.jumps)
			.toBe(1);
		await a.getByRole("button", { name: "Menu", exact: true }).click();
		await a.getByRole("button", { name: "End Match", exact: true }).click();
		for (const page of [a, b]) {
			await expect(
				page.getByRole("heading", { name: "Results", exact: true }),
			).toBeVisible();
			await expect(
				page.getByText("Results saved", { exact: true }),
			).toBeVisible();
			await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(2);
			await page.getByRole("button", { name: "Leave", exact: true }).click();
			await expect(
				page.getByRole("button", { name: "New Solo Game", exact: true }),
			).toBeVisible();
		}
		await a.getByRole("button", { name: "History", exact: true }).click();
		await a
			.getByLabel("Game history")
			.getByRole("button")
			.filter({ hasText: "ROOM" })
			.click();
		await expect(a.getByLabel("Match participants")).toContainText(peerName);
	} finally {
		await account.close();
		await guest.close();
	}
});
