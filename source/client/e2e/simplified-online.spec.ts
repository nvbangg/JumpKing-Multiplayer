import { expect, type Page, test } from "@playwright/test";
import { required } from "../src/required";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires isolated backend/MySQL",
);

async function register(page: Page, suffix: string) {
	const username = `user_${Date.now()}_${suffix}`;
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	await page.goto("/");
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
	await page.getByLabel("Username", { exact: true }).fill(username);
	await page.getByLabel("Password", { exact: true }).fill("123456");
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: username, exact: true }),
	).toBeVisible();
	return username;
}

test("username account, change password and online authentication", async ({
	page,
}) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Create Room", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Sign In / Log In", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Back", exact: true }).click();
	const username = await register(page, "auth");
	await page.getByRole("button", { name: username, exact: true }).click();
	expect(
		await page.locator(".account-info").evaluate((info) => {
			const button = Array.from(document.querySelectorAll("button")).find(
				(button) => button.textContent === "Change Password",
			);
			return (
				!!button &&
				!!(
					info.compareDocumentPosition(button) &
					Node.DOCUMENT_POSITION_FOLLOWING
				)
			);
		}),
	).toBe(true);
	await page
		.getByRole("button", { name: "Change Password", exact: true })
		.click();
	await page.getByLabel("Current Password", { exact: true }).fill("123456");
	await page.getByLabel("New Password", { exact: true }).fill("654321");
	await page.getByLabel("Confirm New Password", { exact: true }).fill("654321");
	await page
		.getByRole("button", { name: "Change Password", exact: true })
		.click();
	await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
	await page.getByLabel("Username", { exact: true }).fill(username);
	await page.getByLabel("Password", { exact: true }).fill("654321");
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: username, exact: true }),
	).toBeVisible();
	await expect(page.getByRole("switch", { name: /Display Timer/ })).toHaveCount(
		0,
	);
	await expect(
		page.getByRole("button", { name: "Controls", exact: true }),
	).toHaveCount(0);
});

test("Room entry, public lobby chat, server countdown and end/leave", async ({
	browser,
}) => {
	test.setTimeout(120000);
	const ca = await browser.newContext(),
		cb = await browser.newContext();
	const a = await ca.newPage(),
		b = await cb.newPage();
	try {
		const host = await register(a, "host"),
			peer = await register(b, "peer");
		await a.getByRole("button", { name: "Create Room", exact: true }).click();
		await expect(a.getByLabel("Visibility", { exact: true })).toHaveValue(
			"PRIVATE",
		);
		await expect(
			a.getByRole("button", { name: "Chat", exact: true }),
		).toHaveCount(0);
		const room = required(await a.locator(".room-code code").textContent());
		await a.getByLabel("Visibility", { exact: true }).selectOption("PUBLIC");
		await b
			.getByRole("button", { name: "Join Public Room", exact: true })
			.click();
		await b.getByRole("button", { name: new RegExp(room) }).click();
		await expect(a.getByText(peer, { exact: true })).toBeVisible();
		await a.getByLabel("Message", { exact: true }).fill("hello from lobby");
		await a.getByRole("button", { name: "Send", exact: true }).click();
		await expect(
			b.getByRole("log").getByText("hello from lobby"),
		).toBeVisible();
		await a.bringToFront();
		await a.getByRole("button", { name: "Start", exact: true }).click();
		await expect(a.locator("canvas")).toBeVisible({ timeout: 40000 });
		await expect(b.locator("canvas")).toBeVisible({ timeout: 40000 });
		await expect(
			a.getByRole("status").filter({ hasText: /^[123]$/ }),
		).toBeVisible({ timeout: 15000 });
		await expect(
			a.getByRole("status").filter({ hasText: /^[123]$/ }),
		).toHaveCount(0, { timeout: 8000 });
		await expect(
			a.getByRole("timer", { name: "Play time", exact: true }),
		).toBeVisible();
		await expect(a.getByText(/^Jumps:/)).toHaveCount(0);
		await a.bringToFront();
		if (
			await a.getByRole("button", { name: "Resume", exact: true }).isVisible()
		)
			await a.getByRole("button", { name: "Resume", exact: true }).click();
		await a.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await expect(
			a.getByRole("button", { name: /Pause Room|Resume Room/ }),
		).toHaveCount(0);
		await a.getByRole("button", { name: "End Match", exact: true }).click();
		await expect(
			a.getByRole("heading", { name: "Results", exact: true }),
		).toBeVisible();
		await expect(
			a.getByRole("cell", { name: host, exact: true }),
		).toBeVisible();
		await expect(
			a.getByRole("cell", { name: peer, exact: true }),
		).toBeVisible();
		await a.getByRole("button", { name: "Leave", exact: true }).click();
		await b.getByRole("button", { name: "Leave", exact: true }).click();
	} finally {
		await ca.close();
		await cb.close();
	}
});

test("Community autosave/continue, manual leaderboard and no ID or in-game New Game", async ({
	page,
}) => {
	test.setTimeout(90000);
	await register(page, "tower");
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(page.locator("canvas")).toBeVisible({ timeout: 40000 });
	await expect(
		page.getByRole("timer", { name: "Play time", exact: true }),
	).toBeVisible();
	await expect(page.getByLabel("Room ID", { exact: true })).toHaveCount(0);
	let requests = 0;
	page.on("request", (request) => {
		if (request.url().includes("/api/leaderboard")) requests++;
	});
	await expect(
		page.getByRole("heading", { name: "Leaderboard", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Refresh", exact: true }),
	).toBeEnabled();
	const before = requests;
	// Chờ qua chu kỳ polling cũ để kiểm tra không tự tải lại.
	await page.waitForTimeout(10500);
	expect(requests).toBe(before);
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect.poll(() => requests).toBe(before + 1);
	if (
		await page.getByRole("button", { name: "Resume", exact: true }).isVisible()
	)
		await page.getByRole("button", { name: "Resume", exact: true }).click();
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "New Game", exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Continue", exact: true }),
	).toBeVisible();
});
