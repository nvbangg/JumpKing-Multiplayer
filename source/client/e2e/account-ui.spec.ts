import { expect, type Page, test } from "@playwright/test";

const identity = {
	authenticated: true,
	account: {
		id: "1",
		username: "google_player",
		crown: "NONE",
		hasPassword: false,
	},
};

async function mockAccount(
	page: Page,
	signedIn = false,
	googleClientId: string | null = null,
) {
	await page.route("**/api/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		const responses: Record<string, unknown> = {
			"/api/auth/me": signedIn
				? identity
				: { authenticated: false, account: null },
			"/api/auth/csrf": { token: "test-csrf", headerName: "X-CSRF-TOKEN" },
			"/api/game-config": {
				features: { flyEnabled: false },
				auth: { googleClientId },
			},
			"/api/community/current": { run: null },
			"/api/profile/me": {
				total: {
					totalPlayTimeMs: 0,
					totalJumps: 0,
					totalFalls: 0,
					finishes: 0,
					matchesPlayed: 0,
					roomWins: 0,
					bestFinishTimeMs: null,
				},
			},
		};
		return path in responses
			? route.fulfill({ json: responses[path] })
			: route.abort();
	});
}

test("Google is hidden without server configuration", async ({ page }) => {
	await mockAccount(page);
	await page.goto("/sign-in");
	await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
	await expect(page.locator(".google-auth-container")).toHaveCount(0);
	await expect(page.locator("#google-jssdk")).toHaveCount(0);
});

test("Google SDK retries manually, blocks duplicate login and ignores a removed form", async ({
	page,
}, info) => {
	await mockAccount(page, false, "server-google-client");
	let sdkRequests = 0;
	await page.route("https://accounts.google.com/gsi/client", (route) => {
		if (++sdkRequests === 1) return route.abort();
		return route.fulfill({
			contentType: "application/javascript",
			body: `
			window.google = { accounts: { id: {
				initialize(config) { this.callback = config.callback; },
				renderButton(parent) {
					const callback = this.callback;
					const button = document.createElement("button");
					button.textContent = "SDK Google Sign-In";
					button.onclick = () => {
						callback({ credential: "test-token" });
						callback({ credential: "test-token" });
					};
					parent.appendChild(button);
				}
			}}};
		`,
		});
	});
	let logins = 0;
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/auth/google", async (route) => {
		logins++;
		await pending;
		await route.fulfill({ json: identity });
	});
	try {
		await page.goto("/sign-in");
		await page
			.getByRole("button", { name: "Retry Google Sign-In", exact: true })
			.click();
		const provider = page.getByRole("button", {
			name: "SDK Google Sign-In",
			exact: true,
		});
		await expect(provider).toBeVisible();
		await page.setViewportSize({ width: 390, height: 844 });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page.screenshot({
			path: info.outputPath("google-sign-in-mobile.png"),
			fullPage: true,
		});
		expect(sdkRequests).toBe(2);
		const removedButton = await provider.elementHandle();
		await page.getByRole("button", { name: "Back", exact: true }).click();
		await removedButton?.evaluate((button) => (button as HTMLElement).click());
		expect(logins).toBe(0);
		await page
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await provider.click();
		await expect(
			page.getByRole("button", { name: "Please wait…", exact: true }),
		).toBeDisabled();
		await expect(page.locator(".google-btn-slot")).toHaveAttribute("inert", "");
		release();
		await expect(
			page.getByRole("button", { name: "google_player", exact: true }),
		).toBeVisible();
		expect(logins).toBe(1);
		await page
			.getByRole("button", { name: "google_player", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "History", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Change Password", exact: true }),
		).toHaveCount(0);
	} finally {
		release();
	}
});

test("a completed sign-in updates the account after leaving the form", async ({
	page,
}) => {
	await mockAccount(page);
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/auth/login", async (route) => {
		await pending;
		await route.fulfill({ json: identity });
	});
	try {
		await page.goto("/sign-in");
		await page.getByLabel("Username", { exact: true }).fill("google_player");
		await page.getByLabel("Password", { exact: true }).fill("123456");
		const request = page.waitForRequest("**/api/auth/login");
		await page
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await request;
		await page.getByRole("button", { name: "Back", exact: true }).click();
		release();
		await expect(
			page.getByRole("button", { name: "google_player", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Sign In / Log In", exact: true }),
		).toHaveCount(0);
	} finally {
		release();
	}
});

test("History reports loading errors and keeps previously loaded rows", async ({
	page,
}) => {
	await mockAccount(page, true);
	const item = (id: string) => ({
		id,
		kind: "COMMUNITY",
		status: "ABANDONED",
		startedAt: "2026-10-24T00:00:00Z",
		endedAt: "2026-10-24T00:01:00Z",
		playTimeMs: 60000,
		jumps: 3,
		falls: 1,
		currentProgress: 200,
		maxProgress: 300,
		finishTimeMs: null,
		room: null,
	});
	await page.route("**/api/history?**", (route) => {
		const requestedPage =
			new URL(route.request().url()).searchParams.get("page") || "0";
		if (requestedPage === "1")
			return route.fulfill({
				status: 503,
				json: { error: { message: "History is temporarily unavailable" } },
			});
		return route.fulfill({
			json: {
				items: [item(requestedPage)],
				page: Number(requestedPage),
				hasNext: requestedPage === "0",
			},
		});
	});
	await page.route("**/api/history/COMMUNITY/0", (route) => route.abort());
	await page.goto("/history");
	const list = page.getByLabel("Game history");
	await expect(
		list.getByRole("button").filter({ hasText: "Abandoned" }),
	).toHaveCount(1);
	await list.getByRole("button", { name: "Load More", exact: true }).click();
	await expect(list.getByRole("alert")).toHaveText(
		"History is temporarily unavailable",
	);
	await expect(
		list.getByRole("button", { name: "Retry", exact: true }),
	).toHaveCount(0);
	await expect(
		list.getByRole("button").filter({ hasText: "Abandoned" }),
	).toHaveCount(1);
	await list
		.getByRole("button")
		.filter({ hasText: "Abandoned" })
		.first()
		.click();
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Retry", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Back", exact: true }),
	).toBeVisible();
});
