import { expect, test } from "@playwright/test";

test("home keeps the required menu and one account form", async ({
	page,
}, info) => {
	const menuAudioRequests: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("menu_loop"))
			menuAudioRequests.push(request.url());
	});
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "Options", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("switch", { name: "Sound: On", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("switch", { name: /Fullscreen/ })).toHaveCount(0);
	await expect(
		page.getByText("Hold Space / W / ↑, then release", { exact: true }),
	).toBeVisible();
	await expect(page.locator(".controls-help dt")).toHaveText(["Move", "Jump"]);
	await expect(
		page.getByRole("button", { name: "Continue", exact: true }),
	).toBeHidden();
	await expect(
		page.getByRole("button", { name: "Leaderboard", exact: true }),
	).toBeHidden();
	await expect(
		page.getByRole("button", { name: "Sign In / Log In", exact: true }),
	).toHaveCount(1);
	await expect(
		page.getByRole("button", { name: /Create Account/ }),
	).toHaveCount(0);
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
	await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
	await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
	await expect(page.locator('form button[type="submit"]')).toHaveCount(1);
	await expect(page.getByText(/If the username does not exist/)).toHaveCount(0);
	expect(menuAudioRequests).toEqual([]);
	await expect(page.locator('form button[type="submit"]')).toHaveText(
		"Sign In / Log In",
	);
	await expect(
		page.getByRole("button", { name: /Create Account/ }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Community", exact: true }),
	).toHaveCount(0);
	await expect(page.getByLabel("Total statistics")).toBeHidden();
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Sign In / Log In", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await page.screenshot({
		path: info.outputPath("menu-desktop.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(
		page.getByRole("button", { name: "New Game", exact: true }),
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

test("one auth flow keeps credentials errors and submits new usernames only to login", async ({
	page,
}) => {
	const mutations: { path: string; body: unknown }[] = [];
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/auth/**", async (route) => {
		const request = route.request(),
			path = new URL(request.url()).pathname;
		if (request.method() === "POST")
			mutations.push({ path, body: request.postDataJSON() });
		if (path === "/api/auth/csrf") {
			await route.fulfill({
				json: { token: "test-csrf", headerName: "X-CSRF-TOKEN" },
			});
		} else if (path === "/api/auth/me") {
			await route.fulfill({ json: { authenticated: false, account: null } });
		} else if (path === "/api/auth/login" && mutations.length === 1) {
			await pending;
			await route.fulfill({
				status: 401,
				json: {
					error: {
						code: "INVALID_CREDENTIALS",
						message: "Username or password is incorrect",
					},
				},
			});
		} else if (path === "/api/auth/login") {
			await route.fulfill({
				json: {
					authenticated: true,
					account: { id: "1", username: "new_player", crownUnlocked: false },
				},
			});
		} else {
			await route.abort();
		}
	});
	await page.route("**/api/community/current", (route) =>
		route.fulfill({ json: { run: null } }),
	);
	try {
		await page.goto("/sign-in");
		await page.getByLabel("Username", { exact: true }).fill("existing_player");
		await page.getByLabel("Password", { exact: true }).fill("wrong");
		await page
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Please wait…", exact: true }),
		).toBeDisabled();
		release();
		await expect(page.getByRole("alert")).toHaveText(
			"Username or password is incorrect",
		);
		await expect(page.getByLabel("Username", { exact: true })).toHaveValue(
			"existing_player",
		);
		await expect(
			page.getByRole("button", { name: "Sign In / Log In", exact: true }),
		).toBeEnabled();
		expect(mutations).toEqual([
			{
				path: "/api/auth/login",
				body: { username: "existing_player", password: "wrong" },
			},
		]);
		await page.getByLabel("Username", { exact: true }).fill("new_player");
		await page.getByLabel("Password", { exact: true }).fill("password123");
		await page
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "new_player", exact: true }),
		).toBeVisible();
		expect(mutations).toEqual([
			{
				path: "/api/auth/login",
				body: { username: "existing_player", password: "wrong" },
			},
			{
				path: "/api/auth/login",
				body: { username: "new_player", password: "password123" },
			},
		]);
	} finally {
		release();
	}
});

test("keyboard navigation restores focus and offline actions report real errors", async ({
	page,
}) => {
	await page.route("**/api/**", (route) => route.abort("connectionrefused"));
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "New Game", exact: true }),
	).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(
		page.getByRole("button", { name: "Room", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("heading", { name: "Sign In / Log In", exact: true }),
	).toBeVisible();
	await expect(page.getByText("Sign in to play online.")).toHaveCount(0);
	expect(
		await page
			.getByRole("heading", { name: "Sign In / Log In", exact: true })
			.evaluate((element) => getComputedStyle(element).userSelect),
	).toBe("none");
	expect(
		await page
			.getByLabel("Username", { exact: true })
			.evaluate((element) => getComputedStyle(element).userSelect),
	).toBe("text");
	await page.getByLabel("Username", { exact: true }).fill("Player");
	await page.getByLabel("Password", { exact: true }).fill("A valid password");
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await expect(page.getByRole("alert")).toHaveText(
		"Unable to connect to the server",
	);
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Room", exact: true }),
	).toBeFocused();
});
