import { expect, type Page, test } from "@playwright/test";
import { required } from "../src/required";
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

function observeLifecycle(page: Page) {
	const state = { leaves: 0, members: [] as string[] };
	page.on("websocket", (socket) => {
		if (new URL(socket.url()).pathname !== "/ws/game") return;
		socket.on("framesent", (frame) => {
			if (JSON.parse(frame.payload.toString()).type === "LEAVE_ROOM")
				state.leaves++;
		});
		socket.on("framereceived", (frame) => {
			const message = JSON.parse(frame.payload.toString());
			if (message.type === "ROOM_STATE")
				state.members = message.payload.members.map(
					(member: { nickname: string }) => member.nickname,
				);
		});
	});
	return state;
}

test("closing a Room page removes its avatar and releases membership through Leave", async ({
	browser,
}) => {
	test.setTimeout(60000);
	const first = await browser.newContext(),
		second = await browser.newContext();
	const a = await first.newPage(),
		b = await second.newPage();
	const lifecycle = observeLifecycle(a),
		peer = observeLifecycle(b),
		observed = observeOnline(b);
	let returned: Page | undefined;
	try {
		const name = await registerOnline(a, "close_host");
		await registerOnline(b, "close_peer");
		const room = await createRoom(a);
		await joinRoom(b, room);
		await startRoom(a, b);
		await expect
			.poll(() =>
				observed.snapshot?.peers.some((item) => item.nickname === name),
			)
			.toBe(true);
		expect(lifecycle.leaves).toBe(0);
		await a.close({ runBeforeUnload: true });
		await expect.poll(() => peer.members.includes(name)).toBe(false);
		await expect
			.poll(() =>
				observed.snapshot?.peers.some((item) => item.nickname === name),
			)
			.toBe(false);
		// Document đóng có thể mất event DevTools; membership phải được giải phóng ngay.
		await expect(
			b.getByRole("button", { name: "Menu", exact: true }),
		).toBeVisible();
		returned = await first.newPage();
		await returned.goto("/");
		await expect(
			returned.getByRole("button", { name, exact: true }),
		).toBeVisible();
		await createRoom(returned);
		await expect(
			returned.getByRole("button", { name: "Start", exact: true }),
		).toBeEnabled();
	} finally {
		if (returned) await leaveOnline(returned);
		await leaveOnline(a);
		await leaveOnline(b);
		await first.close();
		await second.close();
	}
});

test("Back leaves the online context but blur and valid Room transitions do not", async ({
	browser,
}) => {
	test.setTimeout(60000);
	const first = await browser.newContext(),
		second = await browser.newContext();
	const a = await first.newPage(),
		b = await second.newPage();
	const lifecycle = observeLifecycle(a),
		peer = observeLifecycle(b);
	try {
		const name = await registerOnline(a, "back_host");
		await registerOnline(b, "back_peer");
		const room = await createRoom(a);
		await joinRoom(b, room);
		await a.evaluate(() => {
			window.dispatchEvent(new Event("blur"));
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await b.bringToFront();
		await b.getByLabel("Message", { exact: true }).fill("still joined");
		await b.getByRole("button", { name: "Send", exact: true }).click();
		await expect(a.getByRole("log")).toContainText("still joined");
		expect(lifecycle.leaves).toBe(0);
		await a.goBack();
		await expect.poll(() => peer.members.includes(name)).toBe(false);
		expect(lifecycle.leaves).toBe(1);
		await a.goto("/");
		await joinRoom(a, room);
		await startRoom(b, a);
		await b.getByRole("button", { name: "Menu", exact: true }).click();
		await b.getByRole("button", { name: "End Match", exact: true }).click();
		await expect(a.getByText("Results saved", { exact: true })).toBeVisible();
		expect(lifecycle.leaves).toBe(1);
		await a.getByRole("button", { name: "Play Again", exact: true }).click();
		await expect(a.locator(".room-code code")).toHaveText(room);
		expect(lifecycle.leaves).toBe(1);
		await a.getByRole("button", { name: "Leave", exact: true }).click();
		await expect.poll(() => lifecycle.leaves).toBe(2);
		await a.evaluate(() =>
			window.dispatchEvent(new PageTransitionEvent("pagehide")),
		);
		expect(lifecycle.leaves).toBe(2);
	} finally {
		await leaveOnline(a);
		await leaveOnline(b);
		await first.close();
		await second.close();
	}
});

test("Account lobby, permanent chat, selected settings and Host transfer", async ({
	browser,
}) => {
	const ca = await browser.newContext(),
		cb = await browser.newContext();
	const a = await ca.newPage(),
		b = await cb.newPage();
	try {
		const host = await registerOnline(a, "lobby_host"),
			peer = await registerOnline(b, "lobby_peer");
		const id = await createRoom(a);
		await expect(
			a.getByRole("button", { name: "Start", exact: true }),
		).toBeEnabled();
		await joinRoom(b, id);
		await expect(a.locator(".players")).toContainText(peer);
		await expect(b.locator(".players")).toContainText(host);
		await expect(b.getByLabel("Mode", { exact: true })).toBeDisabled();
		await a.getByLabel("Message", { exact: true }).fill("<b>Hello Room</b>");
		await a.getByRole("button", { name: "Send", exact: true }).click();
		await expect(b.getByRole("log")).toContainText(
			`${host}: <b>Hello Room</b>`,
		);
		await expect(b.getByRole("log").locator("b")).toHaveCount(0);
		await expect(
			a.getByRole("button", { name: "Close chat", exact: true }),
		).toHaveCount(0);
		await a.getByLabel("Mode", { exact: true }).selectOption("TIME_LIMIT");
		await expect(b.getByLabel("Minutes", { exact: true })).toHaveValue("5");
		await expect(
			a.getByLabel("Minutes", { exact: true }).locator("option"),
		).toHaveCount(30);
		await a.getByLabel("Minutes", { exact: true }).selectOption("12");
		await expect(b.getByLabel("Minutes", { exact: true })).toHaveValue("12");
		await a.getByLabel("Mode", { exact: true }).selectOption("NO_WALK");
		await expect(b.getByLabel("Mode", { exact: true })).toHaveValue("NO_WALK");
		await a.getByRole("button", { name: "Leave", exact: true }).click();
		await expect(b.getByLabel("Mode", { exact: true })).toBeEnabled();
		await expect(
			b.getByRole("button", { name: "Start", exact: true }),
		).toBeEnabled();
		await expect(b.locator(".room-code code")).toHaveText(id);
		await b.getByRole("button", { name: "Leave", exact: true }).click();
		expect((await (await a.request.get("/api/history")).json()).items).toEqual(
			[],
		);
	} finally {
		await leaveOnline(a);
		await leaveOnline(b);
		await ca.close();
		await cb.close();
	}
});

for (const mode of ["RACE", "HARDCORE", "TIME_LIMIT", "NO_WALK"] as const)
	test(`Room ${mode}: authoritative input, menu clock, End, Play Again and History`, async ({
		browser,
	}) => {
		test.setTimeout(90000);
		const ca = await browser.newContext(),
			cb = await browser.newContext();
		const a = await ca.newPage(),
			b = await cb.newPage(),
			observed = observeOnline(a);
		try {
			const host = await registerOnline(a, "host"),
				peer = await registerOnline(b, "peer");
			const room = await createRoom(a);
			await joinRoom(b, room);
			await a.getByLabel("Mode", { exact: true }).selectOption(mode);
			if (mode === "TIME_LIMIT") {
				await a.getByLabel("Minutes", { exact: true }).selectOption("1");
			}
			await startRoom(a, b);
			await expect
				.poll(() => observed.snapshot?.self.simulation.physics.grounded)
				.toBe(true);
			if (mode === "NO_WALK") {
				const before = required(observed.snapshot).elapsedTimeMs;
				await a.keyboard.down("ArrowRight");
				await expect
					.poll(() => observed.snapshot?.elapsedTimeMs)
					.toBeGreaterThan(before + 300);
				await a.keyboard.up("ArrowRight");
				expect(required(observed.snapshot).self.simulation.physics.x).toBe(231);
				expect(required(observed.snapshot).self.simulation.physics.vx).toBe(0);
			}
			if (mode === "TIME_LIMIT")
				await expect(a.getByLabel("Time left", { exact: true })).toContainText(
					"Time Left:",
				);
			await a.keyboard.down("Space");
			await a.waitForTimeout(220);
			await a.keyboard.up("Space");
			await expect
				.poll(() => observed.snapshot?.self.simulation.physics.jumps)
				.toBe(1);
			await a.getByRole("button", { name: "Menu", exact: true }).click();
			const before = required(observed.snapshot).elapsedTimeMs;
			await expect
				.poll(() => observed.snapshot?.elapsedTimeMs)
				.toBeGreaterThan(before + 500);
			await expect(
				a.getByRole("button", { name: /Pause Room|Resume Room/ }),
			).toHaveCount(0);
			await a.getByRole("button", { name: "End Match", exact: true }).click();
			for (const page of [a, b]) {
				await expect(
					page.getByText("Results saved", { exact: true }),
				).toBeVisible();
				await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(
					2,
				);
			}
			const first = (await (await a.request.get("/api/history")).json())
				.items[0];
			expect(first.room.mode).toBe(mode);
			const detail = await (
				await a.request.get(`/api/history/ROOM/${first.id}`)
			).json();
			expect(
				detail.participants.find(
					(p: { nickname: string }) => p.nickname === host,
				).jumps,
			).toBe(1);
			expect(
				detail.participants.some(
					(p: { nickname: string }) => p.nickname === peer,
				),
			).toBe(true);
			await a.getByRole("button", { name: "Play Again", exact: true }).click();
			await expect(
				a.getByRole("button", { name: "Start", exact: true }),
			).toBeEnabled();
			await expect(
				b.getByRole("heading", { name: "Results", exact: true }),
			).toBeVisible();
			await b.getByRole("button", { name: "Play Again", exact: true }).click();
			await expect(a.locator(".room-code code")).toHaveText(room);
			await expect(a.getByLabel("Mode", { exact: true })).toHaveValue(mode);
			await startRoom(a, b);
			await expect.poll(() => observed.snapshot?.playId).not.toBe(first.id);
			expect(required(observed.snapshot).self.simulation.physics.jumps).toBe(0);
			await a.getByRole("button", { name: "Menu", exact: true }).click();
			await a.getByRole("button", { name: "End Match", exact: true }).click();
			await expect(a.getByText("Results saved", { exact: true })).toBeVisible();
			for (const page of [a, b])
				await page.getByRole("button", { name: "Leave", exact: true }).click();
			expect(
				(await (await a.request.get("/api/history")).json()).items,
			).toHaveLength(2);
			await a.getByRole("button", { name: "History", exact: true }).click();
			await a
				.getByLabel("Game history")
				.getByRole("button")
				.filter({ hasText: "Room" })
				.first()
				.click();
			await expect(
				a.getByLabel("Match participants").getByRole("listitem"),
			).toHaveCount(2);
		} finally {
			await leaveOnline(a);
			await leaveOnline(b);
			await ca.close();
			await cb.close();
		}
	});

for (const mode of ["RACE", "HARDCORE", "TIME_LIMIT", "NO_WALK"] as const)
	test(`one-player Room ${mode}: Start, Players, End, Play Again and History`, async ({
		page,
	}, info) => {
		test.setTimeout(60000);
		const observed = observeOnline(page);
		try {
			await registerOnline(page, "alone");
			await page.getByRole("button", { name: "Room", exact: true }).click();
			const idInput = page.getByPlaceholder("Enter Room ID", { exact: true });
			await expect(idInput).toBeVisible();
			const join = page.getByRole("button", { name: "Join", exact: true });
			const inputBox = required(await idInput.boundingBox()),
				joinBox = required(await join.boundingBox());
			expect(
				Math.abs(
					inputBox.y + inputBox.height / 2 - joinBox.y - joinBox.height / 2,
				),
			).toBeLessThan(2);
			await page
				.getByRole("button", { name: "Create Room", exact: true })
				.click();
			const code = await page.locator(".room-code code").innerText();
			await page.getByLabel("Mode", { exact: true }).selectOption(mode);
			await startRoom(page, page);
			await expect(
				page.getByRole("heading", { name: "Players", exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("list", { name: "Current players" }).locator("li"),
			).toHaveCount(1);
			const id = required(observed.snapshot).playId;
			await page.setViewportSize({ width: 390, height: 844 });
			await page.screenshot({ path: info.outputPath("players-mobile.png") });
			await page.getByRole("button", { name: "Menu", exact: true }).click();
			expect(
				await page.locator(".controls-help").evaluate((help) => {
					const button = Array.from(
						document.querySelectorAll(".game-overlay button"),
					).find((button) => button.textContent === "Leave Room");
					return (
						!!button &&
						!!(
							button.compareDocumentPosition(help) &
							Node.DOCUMENT_POSITION_FOLLOWING
						)
					);
				}),
			).toBe(true);
			await page
				.getByRole("button", { name: "End Match", exact: true })
				.click();
			await expect(
				page.getByText("Results saved", { exact: true }),
			).toBeVisible();
			await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
			const history = (await (await page.request.get("/api/history")).json())
				.items;
			expect(history).toHaveLength(1);
			expect(history[0].room.mode).toBe(mode);
			await page
				.getByRole("button", { name: "Play Again", exact: true })
				.click();
			await expect(page.locator(".room-code code")).toHaveText(code);
			await startRoom(page, page);
			await expect.poll(() => observed.snapshot?.playId).not.toBe(id);
			await page.getByRole("button", { name: "Menu", exact: true }).click();
			await page
				.getByRole("button", { name: "End Match", exact: true })
				.click();
			await expect(
				page.getByText("Results saved", { exact: true }),
			).toBeVisible();
			await page.getByRole("button", { name: "Leave", exact: true }).click();
			expect(
				(await (await page.request.get("/api/history")).json()).items,
			).toHaveLength(2);
		} finally {
			await leaveOnline(page);
		}
	});
