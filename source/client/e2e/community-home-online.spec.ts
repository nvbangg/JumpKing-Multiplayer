import { expect, type Page, test } from "@playwright/test";
import { leaveOnline, newCommunity, registerOnline } from "./support/online";

test.skip(process.env.E2E_AUTH_ONLINE !== "true", "Requires backend/MySQL");
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
});
test.afterEach(async ({ page }) => {
	await leaveOnline(page);
});

async function exitGame(page: Page) {
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Continue", exact: true }),
	).toBeEnabled();
}

// Một tab khác dùng contract thật để thay lượt, không chỉnh state/database.
async function replaceElsewhere(page: Page, expectedRunId: string) {
	return page.evaluate(async (expected) => {
		const path = "/src/network/GameSocket.ts";
		const { GameSocket } = await import(path);
		const socket = new GameSocket(
			() => {},
			() => {},
		);
		try {
			await socket.connect();
			await socket.command("JOIN_COMMUNITY", {
				newRun: true,
				expectedRunId: expected,
			});
			await socket.command("LEAVE_ROOM");
			return (await (await fetch("/api/community/current")).json()).run
				.id as string;
		} finally {
			socket.close();
		}
	}, expectedRunId);
}

test("home opens Community directly; cancel preserves save and Continue preserves identity", async ({
	page,
}) => {
	await registerOnline(page, "home");
	await expect(
		page.getByRole("button", { name: "Continue", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Community", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Leaderboard", exact: true }),
	).toHaveCount(0);
	await newCommunity(page);
	await exitGame(page);
	const saved = (
		await (await page.request.get("/api/community/current")).json()
	).run;
	page.once("dialog", (dialog) => dialog.dismiss());
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	expect(
		(await (await page.request.get("/api/community/current")).json()).run.id,
	).toBe(saved.id);
	await page.reload();
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await exitGame(page);
	expect(
		(await (await page.request.get("/api/community/current")).json()).run.id,
	).toBe(saved.id);
});

test("stale Continue and New Game cannot replace a save changed in another tab", async ({
	page,
}) => {
	await registerOnline(page, "stale");
	await newCommunity(page);
	await exitGame(page);
	const old = (await (await page.request.get("/api/community/current")).json())
		.run.id;
	const next = await replaceElsewhere(page, old);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Community save changed");
	await expect(
		page.getByRole("button", { name: "Continue", exact: true }),
	).toBeEnabled();
	expect(
		(await (await page.request.get("/api/community/current")).json()).run.id,
	).toBe(next);
	const third = await replaceElsewhere(page, next);
	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Community save changed");
	await expect(
		page.getByRole("button", { name: "Continue", exact: true }),
	).toBeEnabled();
	expect(
		(await (await page.request.get("/api/community/current")).json()).run.id,
	).toBe(third);
	expect(
		(await (await page.request.get("/api/history")).json()).items,
	).toHaveLength(2);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
});

test("failed save lookup disables New Game until a successful retry", async ({
	page,
}) => {
	await page.route("**/api/community/current", (route) =>
		route.abort("connectionrefused"),
	);
	await registerOnline(page, "lookup");
	await expect(page.getByRole("alert")).toContainText("Unable to connect");
	await expect(
		page.getByRole("button", { name: "New Game", exact: true }),
	).toBeDisabled();
	await expect(page.getByLabel("Total statistics")).toHaveCount(0);
	await page.unroute("**/api/community/current");
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "New Game", exact: true }),
	).toBeEnabled();
	await expect(page.getByLabel("Total statistics")).toBeVisible();
	expect(
		(await (await page.request.get("/api/community/current")).json()).run,
	).toBeNull();
});

test("late home responses cannot restore the previous Account's save or statistics", async ({
	page,
}) => {
	await registerOnline(page, "previous");
	await newCommunity(page);
	await exitGame(page);
	let release!: () => void, started!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const requested = new Promise<void>((resolve) => {
		started = resolve;
	});
	let first = true;
	const deliveries: Promise<void>[] = [];
	await page.route("**/api/community/current", async (route) => {
		if (!first) {
			await route.continue();
			return;
		}
		first = false;
		const response = await route.fetch();
		started();
		const delivery = held
			.then(() => route.fulfill({ response }))
			.catch(() => {});
		deliveries.push(delivery);
		await delivery;
	});
	try {
		await page.getByRole("button", { name: "Options", exact: true }).click();
		await page.getByRole("button", { name: "Back", exact: true }).click();
		await requested;
		await page.getByRole("button", { name: /^previous_/ }).click();
		await page.getByRole("button", { name: "Sign Out", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "New Game", exact: true }),
		).toBeEnabled();
		await expect(
			page.getByRole("button", { name: "Continue", exact: true }),
		).toHaveCount(0);
		await expect(page.getByLabel("Total statistics")).toHaveCount(0);
		const next = `next_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
		await page.getByRole("button", { name: "Sign In", exact: true }).click();
		await page.getByLabel("Username", { exact: true }).fill(next);
		await page
			.getByLabel("Password", { exact: true })
			.fill("A secure next account password");
		await page.getByRole("button", { name: "Sign In", exact: true }).click();
		await expect(
			page.getByRole("button", { name: next, exact: true }),
		).toBeVisible();
		release();
		await Promise.all(deliveries);
		await expect(
			page.getByRole("button", { name: "New Game", exact: true }),
		).toBeEnabled();
		await expect(
			page.getByRole("button", { name: "Continue", exact: true }),
		).toHaveCount(0);
		expect(
			(await (await page.request.get("/api/community/current")).json()).run,
		).toBeNull();
		await expect(
			page
				.getByLabel("Total statistics")
				.locator("div")
				.filter({ has: page.locator("dt", { hasText: /^Jumps$/ }) })
				.locator("dd"),
		).toHaveText("0");
	} finally {
		release();
	}
});
