import { expect, test } from "@playwright/test";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
});

test("unified Sign In accepts thirty-two Unicode code points for creation and login", async ({
	page,
}) => {
	const name =
		crypto.randomUUID().replaceAll("-", "").slice(0, 12) +
		"\u{20000}".repeat(20);
	await page.goto("/");
	for (let attempt = 0; attempt < 2; attempt++) {
		await page.getByRole("button", { name: "Sign In", exact: true }).click();
		await page.getByLabel("Username", { exact: true }).fill(name);
		await page
			.getByLabel("Password", { exact: true })
			.fill("Unicode account password");
		await page.getByRole("button", { name: "Sign In", exact: true }).click();
		await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
		await page.getByRole("button", { name, exact: true }).click();
		await page.getByRole("button", { name: "Sign Out", exact: true }).click();
	}
});

test("account forms persist the session and sign out clears private home data", async ({
	page,
	context,
}, info) => {
	const name = `player_${Date.now()}`,
		password = "A secure browser password";
	await page.goto("/");
	await page.getByRole("button", { name: "Sign In", exact: true }).click();
	await page.getByLabel("Username", { exact: true }).fill(name);
	await page.getByLabel("Password", { exact: true }).fill(password);
	const signedIn = page.waitForResponse(
		(response) => new URL(response.url()).pathname === "/api/auth/login",
	);
	await page.getByRole("button", { name: "Sign In", exact: true }).click();
	const response = await signedIn;
	expect(response.status()).toBe(200);
	const identity = await response.json();
	expect(identity.authenticated).toBe(true);
	expect(identity.account.username).toBe(name);
	expect(await (await page.request.get("/api/auth/me")).json()).toEqual(
		identity,
	);
	await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Continue", exact: true }),
	).toBeHidden();
	const cookie = (await context.cookies()).find(
		(cookie) => cookie.name === "JSESSIONID",
	);
	expect(cookie?.httpOnly).toBe(true);
	expect(cookie?.sameSite).toBe("Lax");
	await page.getByRole("button", { name, exact: true }).click();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await expect(page.getByLabel("Total statistics")).toBeHidden();
	await page.reload();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await page.screenshot({
		path: info.outputPath("account.png"),
		fullPage: true,
	});
	await page.getByRole("button", { name: "Sign Out", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Sign In", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Continue", exact: true }),
	).toBeHidden();
	await page.getByRole("button", { name: "Sign In", exact: true }).click();
	await page.getByLabel("Username", { exact: true }).fill(name);
	await page.getByLabel("Password", { exact: true }).fill("incorrect");
	await page.getByRole("button", { name: "Sign In", exact: true }).click();
	await expect(page.getByRole("alert")).toHaveText(
		"Username or password is incorrect",
	);
	await page.getByLabel("Password", { exact: true }).fill(password);
	await page.getByRole("button", { name: "Sign In", exact: true }).click();
	await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
});

test("two browser sessions sign in to the same account and sign out independently", async ({
	browser,
}) => {
	const first = await browser.newContext(),
		second = await browser.newContext();
	try {
		const a = await first.newPage(),
			b = await second.newPage(),
			name = `isolated_${Date.now()}`;
		for (const page of [a, b]) {
			await page.goto("/");
			await page.getByRole("button", { name: "Sign In", exact: true }).click();
			await page.getByLabel("Username", { exact: true }).fill(name);
			await page
				.getByLabel("Password", { exact: true })
				.fill("A secure second password");
		}
		await a.getByRole("button", { name: "Sign In", exact: true }).click();
		await expect(a.getByRole("button", { name, exact: true })).toBeVisible();
		await b.getByRole("button", { name: "Sign In", exact: true }).click();
		await expect(b.getByRole("button", { name, exact: true })).toBeVisible();
		await b.getByRole("button", { name, exact: true }).click();
		await b.getByRole("button", { name: "Sign Out", exact: true }).click();
		await expect(
			b.getByRole("button", { name: "Sign In", exact: true }),
		).toBeVisible();
		await a.reload();
		await expect(a.getByRole("button", { name, exact: true })).toBeVisible();
	} finally {
		await first.close();
		await second.close();
	}
});

test("public map/config match the server contract and a rejected handshake closes cleanly", async ({
	page,
}) => {
	let connections = 0;
	page.on("websocket", (socket) => {
		if (new URL(socket.url()).pathname === "/ws/game") connections++;
	});
	await page.goto("/");
	const result = await page.evaluate(async () => {
		const path = "/src/network/GameSocket.ts",
			{ GameSocket } = await import(path);
		const map = await (await fetch("/api/map")).json(),
			config = await (await fetch("/api/game-config")).json();
		let disconnected = 0;
		const socket = new GameSocket(
			() => {},
			() => {
				disconnected++;
			},
		);
		const first = socket.connect(),
			second = socket.connect();
		const shared = first === second;
		const attempts = await Promise.allSettled([first, second]);
		socket.close();
		return {
			screens: map.screens.length,
			fly: config.features.flyEnabled,
			shared,
			disconnected,
			rejected: attempts.every((result) => result.status === "rejected"),
		};
	});
	expect(result).toEqual({
		screens: 43,
		fly: false,
		shared: true,
		disconnected: 1,
		rejected: true,
	});
	expect(connections).toBe(1);
});
