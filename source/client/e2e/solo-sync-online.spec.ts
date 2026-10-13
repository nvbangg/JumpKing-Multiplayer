import { expect, type Page, test } from "@playwright/test";
import type { SoloRun } from "../src/features/solo/storage";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
});
const password = "A secure Solo sync password";
async function register(page: Page, prefix = "sync") {
	const username = prefix + "_" + Date.now();
	await page.goto("/");
	await page
		.getByRole("button", { name: "Create Account", exact: true })
		.click();
	await page.getByLabel("Username", { exact: true }).fill(username);
	await page.getByLabel("Password", { exact: true }).fill(password);
	await page
		.getByRole("button", { name: "Create Account", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: username, exact: true }),
	).toBeVisible();
	const me = await (await page.request.get("/api/auth/me")).json();
	return { username, id: me.account.id as string };
}
async function playAndSave(page: Page) {
	await page
		.getByRole("button", { name: "New Solo Game", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await page.keyboard.down("Space");
	await page.waitForTimeout(220);
	await page.keyboard.up("Space");
	await page.waitForTimeout(800);
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Continue Solo", exact: true }),
	).toBeVisible();
}
async function runs(page: Page, accountId: string): Promise<SoloRun[]> {
	return page.evaluate(async (id) => {
		const path = "/src/features/solo/storage.ts",
			{ soloRuns } = await import(path);
		return soloRuns(location.origin + ":account:" + id);
	}, accountId);
}
async function synced(page: Page, accountId: string) {
	await expect
		.poll(
			async () =>
				(await runs(page, accountId)).every(
					(run) => run.revision === run.syncedRevision,
				),
			{ timeout: 15_000 },
		)
		.toBe(true);
}

test("offline Solo keeps pending History and retry commits each UUID once without uploading snapshots", async ({
	page,
}) => {
	const account = await register(page);
	const uploads: {
		body: Record<string, unknown>;
		account: string | undefined;
	}[] = [];
	page.on("request", (request) => {
		if (request.method() === "PUT" && request.url().includes("/api/solo/runs/"))
			uploads.push({
				body: request.postDataJSON(),
				account: request.headers()["x-account-id"],
			});
	});
	await page.route("**/api/solo/runs/**", (route) =>
		route.abort("connectionrefused"),
	);
	await playAndSave(page);
	page.once("dialog", (dialog) => dialog.accept());
	await page
		.getByRole("button", { name: "New Solo Game", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await page.getByRole("button", { name: "History", exact: true }).click();
	await expect(
		page.getByRole("button").filter({ hasText: "Pending sync" }),
	).toHaveCount(1);
	expect(
		(await (await page.request.get("/api/profile/me")).json()).total
			.totalPlayTimeMs,
	).toBe(0);
	await page.unroute("**/api/solo/runs/**");
	await page.evaluate(() => window.dispatchEvent(new Event("online")));
	await synced(page, account.id);
	await expect(
		page.getByRole("button").filter({ hasText: "Pending sync" }),
	).toHaveCount(0);
	const local = await runs(page, account.id),
		remote = await (await page.request.get("/api/history")).json(),
		stats = await (await page.request.get("/api/profile/me")).json();
	expect(local).toHaveLength(2);
	expect(remote.items).toHaveLength(1);
	expect(remote.items[0].id).toBe(
		local.find((run) => run.status === "ABANDONED")!.id,
	);
	expect(stats.total.totalPlayTimeMs).toBe(
		Math.floor(
			(local.reduce((sum, run) => sum + run.playTicks, 0) * 1000) / 60,
		),
	);
	expect(stats.total.totalJumps).toBe(
		local.reduce((sum, run) => sum + run.jumps, 0),
	);
	expect(uploads.length).toBeGreaterThan(1);
	for (const upload of uploads) {
		expect(upload.body).not.toHaveProperty("snapshot");
		expect(upload.body).not.toHaveProperty("profile");
		expect(upload.account).toBe(account.id);
	}
});

test("one Account on two devices creates separate Solo UUIDs and totals both exactly once", async ({
	page,
	browser,
}) => {
	const account = await register(page, "devices"),
		second = await browser.newContext();
	try {
		await second.addInitScript(() =>
			localStorage.setItem(
				"jumpking.options",
				JSON.stringify({ sound: false }),
			),
		);
		const other = await second.newPage();
		await other.goto("/");
		await other.getByRole("button", { name: "Sign In", exact: true }).click();
		await other.getByLabel("Username", { exact: true }).fill(account.username);
		await other.getByLabel("Password", { exact: true }).fill(password);
		await other.getByRole("button", { name: "Sign In", exact: true }).click();
		await expect(
			other.getByRole("button", { name: account.username, exact: true }),
		).toBeVisible();
		await page.bringToFront();
		await playAndSave(page);
		await synced(page, account.id);
		await other.bringToFront();
		await playAndSave(other);
		await synced(other, account.id);
		const firstRuns = await runs(page, account.id),
			secondRuns = await runs(other, account.id);
		expect(firstRuns).toHaveLength(1);
		expect(secondRuns).toHaveLength(1);
		expect(firstRuns[0]!.id).not.toBe(secondRuns[0]!.id);
		const stats = await (await page.request.get("/api/profile/me")).json();
		expect(stats.total.totalJumps).toBe(
			firstRuns[0]!.jumps + secondRuns[0]!.jumps,
		);
		expect(stats.total.totalPlayTimeMs).toBe(
			Math.floor(
				((firstRuns[0]!.playTicks + secondRuns[0]!.playTicks) * 1000) / 60,
			),
		);
		expect(stats.total.bestFinishTimeMs).toBeNull();
		await page.reload();
		await expect(
			page.getByRole("button", { name: account.username, exact: true }),
		).toBeVisible();
	} finally {
		await second.close();
	}
});

test("switching accounts never uploads a pending Solo run to the new owner", async ({
	page,
}) => {
	const first = await register(page, "original");
	await page.route("**/api/solo/runs/**", (route) =>
		route.abort("connectionrefused"),
	);
	await playAndSave(page);
	await page.getByRole("button", { name: first.username, exact: true }).click();
	await page.getByRole("button", { name: "Sign Out", exact: true }).click();
	const second = await register(page, "replacement");
	await page.unroute("**/api/solo/runs/**");
	const result = await page.evaluate(async (account) => {
		const syncPath = "/src/features/solo/sync.ts",
			apiPath = "/src/network/api.ts",
			storagePath = "/src/features/solo/storage.ts";
		const { syncSolo, soloMetrics } = await import(syncPath),
			{ api } = await import(apiPath),
			{ pendingSoloRuns } = await import(storagePath);
		const profile = location.origin + ":account:" + account;
		const pending = await pendingSoloRuns(profile);
		let checked = "",
			guarded = "";
		try {
			await syncSolo(profile, account);
		} catch (error) {
			checked = (error as { code: string }).code;
		}
		try {
			await api(
				"/solo/runs/" + pending[0].id,
				"PUT",
				soloMetrics(pending[0]),
				account,
			);
		} catch (error) {
			guarded = (error as { code: string }).code;
		}
		return {
			checked,
			guarded,
			pending: (await pendingSoloRuns(profile)).length,
		};
	}, first.id);
	expect(result).toEqual({
		checked: "UNAUTHENTICATED",
		guarded: "CONFLICT",
		pending: 1,
	});
	const stats = await (await page.request.get("/api/profile/me")).json();
	expect(stats.username).toBe(second.username);
	expect(stats.total.totalPlayTimeMs).toBe(0);
});
