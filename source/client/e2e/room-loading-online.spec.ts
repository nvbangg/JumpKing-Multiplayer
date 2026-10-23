import { expect, type Page, test } from "@playwright/test";
import {
	createRoom,
	joinRoom,
	leaveOnline,
	observeOnline,
	registerOnline,
	startRoom,
} from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires isolated backend/MySQL",
);

async function kingTexture(page: Page) {
	const manifest = await (
		await page.request.get("/assets/manifest.json")
	).json();
	return (
		"/assets/" +
		manifest.textures["king/base"].file
			.split("/")
			.map(encodeURIComponent)
			.join("/")
	);
}

async function end(host: Page, peer: Page) {
	await host.bringToFront();
	if (
		await host.getByRole("button", { name: "Resume", exact: true }).isVisible()
	)
		await host.getByRole("button", { name: "Resume", exact: true }).click();
	await host.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	await host.getByRole("button", { name: "End Match", exact: true }).click();
	await expect(host.getByText("Results saved", { exact: true })).toBeVisible();
	for (const page of [host, peer])
		await page.getByRole("button", { name: "Leave", exact: true }).click();
}

test("slow renderer holds the whole roster before the single server countdown", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const ca = await browser.newContext(),
		cb = await browser.newContext();
	const a = await ca.newPage(),
		b = await cb.newPage(),
		observed = observeOnline(b);
	let release!: () => void, requested!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const started = new Promise<void>((resolve) => {
		requested = resolve;
	});
	try {
		await registerOnline(a, "slow_host");
		await registerOnline(b, "slow_peer");
		const id = await createRoom(a);
		await joinRoom(b, id);
		await a.route(await kingTexture(a), async (route) => {
			requested();
			await held;
			await route.continue();
		});
		await a.bringToFront();
		await a.getByRole("button", { name: "Start", exact: true }).click();
		await started;
		await expect(
			b.getByText("Waiting for players…", { exact: true }),
		).toBeVisible({ timeout: 15000 });
		// Lâu hơn countdown: người đã tải xong vẫn chưa mất thời gian thi đấu.
		await a.waitForTimeout(3500);
		expect(observed.snapshot).toBeUndefined();
		await expect(b.getByLabel("Play time", { exact: true })).toHaveText(
			"00:00s",
		);
		release();
		await expect(
			a.getByRole("status").filter({ hasText: /^[123]$/ }),
		).toBeVisible({ timeout: 15000 });
		await expect
			.poll(() => observed.snapshot?.elapsedTimeMs ?? 0, { timeout: 10000 })
			.toBeGreaterThan(0);
		await end(a, b);
	} finally {
		release();
		await leaveOnline(a);
		await leaveOnline(b);
		await ca.close();
		await cb.close();
	}
});

test("failed texture never acknowledges readiness and Leave permits a fresh start in the same Room", async ({
	browser,
}) => {
	test.setTimeout(90000);
	const ca = await browser.newContext(),
		cb = await browser.newContext();
	const a = await ca.newPage(),
		b = await cb.newPage(),
		observed = observeOnline(b),
		errors: string[] = [];
	let ready = 0;
	a.on("websocket", (socket) => {
		if (new URL(socket.url()).pathname !== "/ws/game") return;
		socket.on("framesent", (frame) => {
			if (JSON.parse(frame.payload.toString()).type === "GAME_READY") ready++;
		});
	});
	for (const page of [a, b])
		page.on("pageerror", (error) => errors.push(error.message));
	try {
		await registerOnline(a, "failed_host");
		await registerOnline(b, "failed_peer");
		const id = await createRoom(a);
		await joinRoom(b, id);
		const texture = await kingTexture(a);
		await a.route(texture, (route) => route.abort("failed"));
		await a.bringToFront();
		await a.getByRole("button", { name: "Start", exact: true }).click();
		await expect(a.getByRole("alert")).toContainText(
			"Could not load king/base",
			{ timeout: 20000 },
		);
		await a.waitForTimeout(3500);
		expect(ready).toBe(0);
		expect(observed.snapshot).toBeUndefined();
		await a.getByRole("button", { name: "Leave", exact: true }).click();
		await expect(
			b.getByRole("heading", { name: "Lobby", exact: true }),
		).toBeVisible();
		await expect(
			b.getByRole("button", { name: "Start", exact: true }),
		).toBeEnabled();
		expect((await (await a.request.get("/api/history")).json()).items).toEqual(
			[],
		);
		await a.unroute(texture);
		await joinRoom(a, id);
		await startRoom(b, a);
		await end(b, a);
		expect(errors).toEqual([]);
	} finally {
		await leaveOnline(a);
		await leaveOnline(b);
		await ca.close();
		await cb.close();
	}
});
