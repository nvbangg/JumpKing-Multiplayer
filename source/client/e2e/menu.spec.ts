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
	await expect(page.getByRole("switch", { name: /^Sound:/ })).toHaveCount(0);
	await expect(page.getByRole("switch", { name: /Fullscreen/ })).toHaveCount(0);
	await expect(page.locator(".controls-help")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "History", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Room", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Create Room", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Join Public Room", exact: true }),
	).toBeVisible();
	await expect(page.getByLabel("Room ID", { exact: true })).toBeVisible();
	expect(
		await page
			.getByLabel("Room ID", { exact: true })
			.evaluate((input) => input.getBoundingClientRect().width),
	).toBeLessThanOrEqual(200);
	const newGame = page.getByRole("button", { name: "New Game", exact: true });
	const roomId = page.getByLabel("Room ID", { exact: true });
	await roomId.focus();
	await expect(roomId).toHaveCSS("outline-style", "none");
	await roomId.hover();
	await expect(roomId).toHaveCSS("background-color", "rgb(22, 22, 22)");
	expect(
		await page
			.locator(".room-join-form")
			.evaluate((form) => getComputedStyle(form, "::before").content),
	).toBe('""');
	await page.mouse.move(0, 0);
	const restingBackground = await newGame.evaluate(
		(button) => getComputedStyle(button).backgroundColor,
	);
	await newGame.hover();
	await expect(newGame).toHaveCSS("background-color", "rgb(28, 25, 17)");
	await expect(newGame).toHaveCSS("color", "rgb(246, 202, 109)");
	expect(
		await newGame.evaluate(
			(button) => getComputedStyle(button, "::before").content,
		),
	).toBe('""');
	expect(restingBackground).not.toBe("rgb(28, 25, 17)");
	await expect(
		page.getByRole("button", { name: "Join", exact: true }),
	).toBeVisible();
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
}, info) => {
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
					account: {
						id: "1",
						username: "new_player",
						crown: "NONE",
						hasPassword: true,
					},
				},
			});
		} else {
			await route.abort();
		}
	});
	await page.route("**/api/community/current", (route) =>
		route.fulfill({ json: { run: null } }),
	);
	await page.route("**/api/profile/me", (route) =>
		route.fulfill({
			json: {
				total: {
					totalPlayTimeMs: 0,
					totalJumps: 0,
					totalFalls: 0,
					finishes: 0,
					matchesPlayed: 0,
					bestFinishTimeMs: null,
				},
			},
		}),
	);
	await page.route("**/api/history?**", (route) =>
		route.fulfill({ json: { items: [], page: 0, hasNext: false } }),
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
		await expect(
			page.getByRole("button", { name: "History", exact: true }),
		).toHaveCount(0);
		await expect(page.getByLabel("Total statistics")).toBeVisible();
		await page.screenshot({
			path: info.outputPath("home-account.png"),
			fullPage: true,
		});
		await page.getByRole("button", { name: "new_player", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Change Password", exact: true }),
		).toBeVisible();
		await page.screenshot({
			path: info.outputPath("account-history.png"),
			fullPage: true,
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await page.screenshot({
			path: info.outputPath("account-mobile.png"),
			fullPage: true,
		});
		await page.getByRole("button", { name: "History", exact: true }).click();
		await expect(
			page.getByRole("heading", { name: "History", exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Back", exact: true }).click();
		await expect(
			page.getByRole("heading", { name: "Account", exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Back", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "new_player", exact: true }),
		).toBeFocused();
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

test("room ID supports Tab order and arrow navigation without capturing text editing", async ({
	page,
}) => {
	await page.route("**/api/**", (route) => route.abort("connectionrefused"));
	await page.goto("/");
	const create = page.getByRole("button", { name: "Create Room", exact: true });
	const publicRooms = page.getByRole("button", {
		name: "Join Public Room",
		exact: true,
	});
	const roomId = page.getByLabel("Room ID", { exact: true });
	const join = page.getByRole("button", { name: "Join", exact: true });
	await page.keyboard.press("Tab");
	await expect(create).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(publicRooms).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(roomId).toBeFocused();
	expect(
		await page
			.locator(".room-join-form")
			.evaluate((form) => getComputedStyle(form, "::before").content),
	).toBe('""');
	await page.keyboard.press("Tab");
	await expect(join).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await expect(roomId).toBeFocused();
	await roomId.fill("123456");
	await page.keyboard.press("Home");
	await page.keyboard.press("ArrowRight");
	expect(
		await roomId.evaluate((input: HTMLInputElement) => input.selectionStart),
	).toBe(1);
	await page.keyboard.press("ArrowDown");
	await expect(roomId).toBeFocused();
	await publicRooms.focus();
	await page.keyboard.press("ArrowDown");
	await expect(roomId).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(join).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(roomId).toBeFocused();
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
		page.getByRole("button", { name: "Create Room", exact: true }),
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
		page.getByRole("button", { name: "Create Room", exact: true }),
	).toBeFocused();
});
