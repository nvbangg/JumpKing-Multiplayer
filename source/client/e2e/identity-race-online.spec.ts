import { expect, test } from "@playwright/test";

test.skip(
	process.env.E2E_IDENTITY_RACE !== "true",
	"Requires the isolated identity race harness",
);
test("a delayed anonymous me response cannot overwrite a subsequently registered Account", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	let release!: () => void,
		intercepted!: () => void,
		holding = true;
	const deliveries: Promise<void>[] = [];
	const held = new Promise<void>((resolve) => {
			release = resolve;
		}),
		ready = new Promise<void>((resolve) => {
			intercepted = resolve;
		});
	await page.route("**/api/auth/me", async (route) => {
		if (!holding) {
			await route.continue();
			return;
		}
		let returned!: () => void;
		deliveries.push(
			new Promise<void>((resolve) => {
				returned = resolve;
			}),
		);
		const response = await route.fetch();
		expect((await response.json()).authenticated).toBe(false);
		intercepted();
		await held;
		await route.fulfill({ response });
		returned();
	});
	try {
		await page.goto("/");
		await ready;
		const name = `race_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
		await page.getByRole("button", { name: "Sign In", exact: true }).click();
		await page.getByLabel("Username", { exact: true }).fill(name);
		await page
			.getByLabel("Password", { exact: true })
			.fill("A secure identity race password");
		await page.getByRole("button", { name: "Sign In", exact: true }).click();
		await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
		holding = false;
		release();
		await Promise.all(deliveries);
		await expect(
			page.getByRole("button", { name: "New Game", exact: true }),
		).toBeVisible();
		await expect(
			page.getByText("Sign in to play Community.", { exact: true }),
		).toBeHidden();
		expect(
			(await (await page.request.get("/api/auth/me")).json()).account.username,
		).toBe(name);
	} finally {
		release();
	}
});
