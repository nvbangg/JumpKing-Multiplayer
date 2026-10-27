import { expect, test } from "@playwright/test";
import { required } from "../src/required";
import { leaveOnline, observeOnline } from "./support/online";

test.skip(
	!process.env.E2E_SOLO_ROCK,
	"Requires the isolated solo Rock fixture",
);
test.use({
	viewport: { width: 844, height: 390 },
	isMobile: true,
	hasTouch: true,
});
test("solo Rock rejection is a two-second notice and never leaks into Results", async ({
	page,
}, info) => {
	const fixture = JSON.parse(required(process.env.E2E_SOLO_ROCK));
	const observed = observeOnline(page);
	const codes: string[] = [];
	page.on("websocket", (socket) =>
		socket.on("framereceived", (frame) => {
			const message = JSON.parse(frame.payload.toString());
			if (message.type === "ERROR") codes.push(message.payload.code);
		}),
	);
	try {
		await page.addInitScript(() =>
			localStorage.setItem(
				"jumpking.options",
				JSON.stringify({ sound: false }),
			),
		);
		await page.goto("/");
		await page
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await page.getByLabel("Username", { exact: true }).fill(fixture.username);
		await page.getByLabel("Password", { exact: true }).fill(fixture.password);
		await page
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "New Game", exact: true }),
		).toBeVisible();
		await page.evaluate(async (credential) => {
			const path = "/src/network/reconnect.ts";
			const { saveReconnect } = await import(path);
			await saveReconnect(
				`${location.origin}:account:${credential.owner}`,
				credential.context,
			);
		}, fixture);
		await page.reload();
		await page.getByRole("button", { name: "Resume", exact: true }).click();
		await expect.poll(() => observed.snapshot?.items?.held).toBe("ROCK");
		const item = page.getByRole("button", { name: "Use item", exact: true });
		const notice = page.locator(".item-notice");
		await item.tap();
		await expect(notice).toHaveText("No other player is available");
		expect(codes).toContain("NO_ITEM_TARGET");
		await expect(page.locator(".save-error")).toHaveCount(0);
		await page.waitForTimeout(1100);
		await item.tap();
		await page.waitForTimeout(1100);
		await expect(notice).toBeVisible();
		await page.screenshot({ path: info.outputPath("solo-rock-notice.png") });
		await expect(notice).toHaveCount(0, { timeout: 1400 });
		expect(observed.snapshot?.items?.held).toBe("ROCK");
		await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await page.getByRole("button", { name: "End Match", exact: true }).click();
		await expect(
			page.getByRole("heading", { name: "Results", exact: true }),
		).toBeVisible();
		await expect(
			page.getByText("No other player is available", { exact: true }),
		).toHaveCount(0);
	} finally {
		await leaveOnline(page);
	}
});
