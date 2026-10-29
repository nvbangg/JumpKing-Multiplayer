import { expect, type Page, test } from "@playwright/test";
import type { OnlineSnapshot } from "../src/game/netcode/OnlineRuntime";
import { NETWORK } from "../src/network/config";
import { required } from "../src/required";
import { leaveOnline } from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);
test.afterEach(async ({ page }) => {
	await leaveOnline(page);
});
async function account(page: Page, prefix: string) {
	const name = `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
	await page.goto("/");
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await page.getByLabel("Username", { exact: true }).fill(name);
	await page
		.getByLabel("Password", { exact: true })
		.fill("A secure Community test password");
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
	return name;
}
function observe(page: Page) {
	const state: {
		snapshots: OnlineSnapshot[];
		rosters: {
			members: { playerId: string; nickname: string; colorSlot: number }[];
		}[];
		errors: string[];
		leaves: number;
	} = { snapshots: [], rosters: [], errors: [], leaves: 0 };
	page.on("websocket", (socket) => {
		if (new URL(socket.url()).pathname !== "/ws/game") return;
		socket.on("framesent", (frame) => {
			if (JSON.parse(frame.payload.toString()).type === "LEAVE_ROOM")
				state.leaves++;
		});
		socket.on("framereceived", (frame) => {
			const message = JSON.parse(frame.payload.toString());
			if (message.type === "GAME_SNAPSHOT")
				state.snapshots.push(message.payload);
			if (message.type === "ROOM_STATE") state.rosters.push(message.payload);
			if (message.type === "ERROR") state.errors.push(message.payload.code);
		});
	});
	return state;
}
async function observeSound(page: Page) {
	await page.evaluate(async () => {
		const path = "/src/game/presentation/AudioBus.ts",
			configPath = "/src/game/presentation/config.ts",
			{ AudioBus } = await import(path),
			{ PRESENTATION } = await import(configPath);
		const original = AudioBus.prototype.effect;
		const calls: { effect: string; volume: number }[] = [];
		Object.assign(window, { onlineSoundCalls: calls });
		AudioBus.prototype.effect = function (
			effect: string,
			state: { snow: boolean; ice: boolean },
			volume: number = PRESENTATION.effectVolume,
		) {
			calls.push({ effect, volume });
			original.call(this, effect, state, volume);
		};
	});
}
async function jump(page: Page) {
	await page.bringToFront();
	if (
		await page.getByRole("button", { name: "Resume", exact: true }).isVisible()
	)
		await page.getByRole("button", { name: "Resume", exact: true }).click();
	await page.keyboard.down("Space");
	await page.waitForTimeout(220);
	await page.keyboard.up("Space");
}
async function leave(page: Page) {
	await page.bringToFront();
	if (
		!(await page
			.getByRole("button", { name: "Save & Exit", exact: true })
			.isVisible())
	)
		await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "New Game", exact: true }),
	).toBeVisible();
}
for (const failure of ["rejected", "timeout"] as const)
	test(`Browser Back reports ${failure} Leave and allows Save & Exit to retry`, async ({
		page,
	}) => {
		const observed = observe(page);
		let attempts = 0;
		await page.routeWebSocket("**/ws/game", (socket) => {
			const server = socket.connectToServer();
			socket.onMessage((data) => {
				const message = JSON.parse(data.toString());
				if (message.type === "LEAVE_ROOM" && ++attempts === 1) {
					if (failure === "rejected")
						socket.send(
							JSON.stringify({
								v: 1,
								type: "ERROR",
								requestId: message.requestId,
								payload: {
									code: "SAVE_FAILED",
									message: "Community progress could not be saved",
								},
							}),
						);
					return;
				}
				server.send(data);
			});
		});
		await account(page, `leave_${failure}`);
		await page.getByRole("button", { name: "New Game", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible({ timeout: 30000 });
		await expect.poll(() => observed.snapshots.length).toBeGreaterThan(0);
		const run = required(observed.snapshots.at(-1)).playId;
		await page.goBack();
		const message =
			failure === "rejected"
				? "Community progress could not be saved"
				: "The server has not confirmed this action";
		await expect(page.getByRole("alert")).toHaveText(message, {
			timeout: NETWORK.timeoutMs + 5000,
		});
		expect(attempts).toBe(1);
		expect(required(observed.snapshots.at(-1)).playId).toBe(run);
		await leave(page);
		expect(attempts).toBe(2);
		await expect(page.getByRole("alert")).toHaveCount(0);
		const count = observed.snapshots.length;
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible({ timeout: 30000 });
		await expect.poll(() => observed.snapshots.length).toBeGreaterThan(count);
		expect(required(observed.snapshots.at(-1)).playId).toBe(run);
		await expect(page.getByRole("alert")).toHaveCount(0);
	});
test("two Accounts share server simulation, see each other jump, leave and Continue the saved run", async ({
	browser,
}, info) => {
	const first = await browser.newContext(),
		second = await browser.newContext();
	try {
		for (const context of [first, second])
			await context.addInitScript(() => {
				if (location.protocol === "http:" || location.protocol === "https:")
					localStorage.setItem(
						"jumpking.options",
						JSON.stringify({ sound: false }),
					);
			});
		const a = await first.newPage(),
			b = await second.newPage(),
			observedA = observe(a),
			observedB = observe(b);
		const nameA = await account(a, "tower_a"),
			nameB = await account(b, "tower_b");
		await observeSound(a);
		await observeSound(b);
		await a.bringToFront();
		await a.getByRole("button", { name: "New Game", exact: true }).click();
		await expect(
			a.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect.poll(() => observedA.snapshots.length).toBeGreaterThan(0);
		const runId = required(observedA.snapshots.at(-1)).playId;
		await b.getByRole("button", { name: "New Game", exact: true }).click();
		await expect(
			b.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect.poll(() => observedA.rosters.at(-1)?.members.length).toBe(2);
		await expect.poll(() => observedB.rosters.at(-1)?.members.length).toBe(2);
		expect(
			required(observedA.rosters.at(-1))
				.members.map((member) => member.nickname)
				.sort(),
		).toEqual([nameA, nameB].sort());
		expect(
			new Set(
				required(observedA.rosters.at(-1)).members.map(
					(member) => member.colorSlot,
				),
			).size,
		).toBe(2);
		await expect
			.poll(() => observedB.snapshots.at(-1)?.players?.length)
			.toBe(2);
		await expect(
			b.getByRole("heading", { name: "Players", exact: true }),
		).toBeVisible();
		await expect(
			b.getByRole("list", { name: "Current players" }).locator("li"),
		).toHaveCount(2);
		expect(
			required(required(observedB.snapshots.at(-1)).players).map(
				(player) => player.rank,
			),
		).toEqual([1, 1]);
		await b.locator("canvas").click();
		await expect(b.locator("canvas")).toBeFocused();
		await jump(a);
		await expect
			.poll(() => observedA.snapshots.at(-1)?.self.simulation.physics.jumps)
			.toBeGreaterThan(0);
		await expect
			.poll(() => observedB.snapshots.at(-1)?.peers[0]?.state.jumps)
			.toBeGreaterThan(0);
		await jump(b);
		await expect
			.poll(() => observedB.snapshots.at(-1)?.self.simulation.physics.jumps)
			.toBeGreaterThan(0);
		await expect
			.poll(() => observedA.snapshots.at(-1)?.peers[0]?.state.jumps)
			.toBeGreaterThan(0);
		const sounds = await a.evaluate(
			() =>
				(
					window as unknown as {
						onlineSoundCalls: { effect: string; volume: number }[];
					}
				).onlineSoundCalls,
		);
		expect(
			sounds.filter((call) => call.effect === "JUMP" && call.volume === 0.65),
		).toHaveLength(1);
		expect(
			sounds.filter((call) => call.effect === "JUMP" && call.volume === 0.35),
		).toHaveLength(1);
		expect(
			required(required(observedA.snapshots.at(-1)).peers[0]).state,
		).not.toHaveProperty("directions");
		expect(required(observedA.snapshots.at(-1)).peers[0]).not.toHaveProperty(
			"adventure",
		);
		await a.bringToFront();
		if (
			await a.getByRole("button", { name: "Resume", exact: true }).isVisible()
		)
			await a.getByRole("button", { name: "Resume", exact: true }).click();
		await a.getByLabel("Message", { exact: true }).focus();
		const text = '<img src=x onerror="window.chatInjected=true"> hello';
		await a.getByLabel("Message", { exact: true }).fill(text);
		await a.getByRole("button", { name: "Send", exact: true }).click();
		await expect(a.getByRole("log")).toContainText(text);
		expect(await a.evaluate(() => "chatInjected" in window)).toBe(false);
		await a.getByLabel("Message", { exact: true }).press("Escape");
		await b.bringToFront();
		if (
			await b.getByRole("button", { name: "Resume", exact: true }).isVisible()
		)
			await b.getByRole("button", { name: "Resume", exact: true }).click();
		await b.getByLabel("Message", { exact: true }).focus();
		await expect(b.getByRole("log")).toContainText(text);
		await b.getByLabel("Message", { exact: true }).press("Escape");
		expect(observedA.errors).toEqual([]);
		expect(observedB.errors).toEqual([]);
		await a.screenshot({ path: info.outputPath("community-two-players.png") });
		await leave(a);
		const saved = await (await a.request.get("/api/community/current")).json();
		expect(saved.run.id).toBe(runId);
		expect(saved.run.elapsedTimeMs).toBeGreaterThan(0);
		expect(saved).not.toHaveProperty("snapshot");
		await expect.poll(() => observedB.rosters.at(-1)?.members.length).toBe(1);
		await a.getByRole("button", { name: "Continue", exact: true }).click();
		await expect(
			a.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible();
		await expect.poll(() => observedA.snapshots.at(-1)?.playId).toBe(runId);
		expect(
			required(observedA.snapshots.at(-1)).self.simulation.physics.jumps,
		).toBeGreaterThan(0);
		await a.getByLabel("Message", { exact: true }).focus();
		await expect(a.getByRole("log")).toContainText(text);
		await a.getByLabel("Message", { exact: true }).press("Escape");
		await leave(b);
		await expect(
			a.getByRole("heading", { name: "Leaderboard", exact: true }),
		).toBeVisible();
		const entries = (
			await (await a.request.get("/api/leaderboard?limit=100")).json()
		).entries;
		const best = entries.find(
			(entry: { username: string }) => entry.username === nameA,
		);
		expect(best.id).toBe(runId);
		const row = a
			.getByLabel("Community records")
			.getByRole("listitem")
			.filter({ hasText: nameA });
		await expect(row).toHaveCount(1);
		await expect(row).toContainText(`${best.rank}. ${nameA}`);
		await expect(row).toContainText(`${Math.floor(best.maxProgress)} px`);
		await leave(a);
		await expect(
			a.getByRole("button", { name: "Continue", exact: true }),
		).toBeVisible();
	} finally {
		for (const context of [first, second])
			for (const page of context.pages()) await leaveOnline(page);
		await first.close();
		await second.close();
	}
});
test("prediction stays usable with delayed and reordered snapshots across Pause and Resume", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	let count = 0;
	await page.routeWebSocket("**/ws/game", (socket) => {
		const server = socket.connectToServer(),
			timers = new Set<ReturnType<typeof setTimeout>>();
		server.onMessage((message) => {
			const value = JSON.parse(message.toString());
			if (value.type !== "GAME_SNAPSHOT") {
				socket.send(message);
				return;
			}
			const timer = setTimeout(
				() => {
					timers.delete(timer);
					socket.send(message);
				},
				++count % 5 === 0 ? 180 : 100,
			);
			timers.add(timer);
		});
		socket.onClose(() => {
			timers.forEach(clearTimeout);
			server.close();
		});
	});
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const observed = observe(page);
	await account(page, "latency");
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu (Esc)", exact: true }),
	).toBeVisible();
	await page.waitForTimeout(500);
	await jump(page);
	await expect
		.poll(() => observed.snapshots.at(-1)?.self.simulation.physics.jumps)
		.toBe(1);
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Resume", exact: true }),
	).toBeVisible();
	await page.waitForTimeout(700);
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	await page.waitForTimeout(500);
	await expect(
		page.getByRole("button", { name: "Resume", exact: true }),
	).toHaveCount(0);
	await jump(page);
	await expect
		.poll(() => observed.snapshots.at(-1)?.self.simulation.physics.jumps)
		.toBe(2);
	await expect(page.getByRole("alert")).toHaveCount(0);
	expect(errors).toEqual([]);
	await leave(page);
});
test("Community New Game keeps old History and metrics while replacing only the active checkpoint", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	const observed = observe(page);
	await account(page, "new_run");
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu (Esc)", exact: true }),
	).toBeVisible();
	await expect.poll(() => observed.snapshots.length).toBeGreaterThan(0);
	const first = required(observed.snapshots.at(-1)).playId;
	await jump(page);
	await expect
		.poll(() => observed.snapshots.at(-1)?.self.simulation.physics.jumps)
		.toBe(1);
	await leave(page);
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Replace your unfinished game?" })
		.getByRole("button", { name: "Confirm", exact: true })
		.click();
	await expect.poll(() => observed.snapshots.at(-1)?.playId).not.toBe(first);
	expect(
		required(observed.snapshots.at(-1)).self.simulation.physics.jumps,
	).toBe(0);
	await leave(page);
	const history = await (await page.request.get("/api/history")).json(),
		stats = await (await page.request.get("/api/profile/me")).json();
	expect(history.items).toHaveLength(1);
	expect(history.items[0]).toMatchObject({
		id: first,
		kind: "COMMUNITY",
		status: "ABANDONED",
		jumps: 1,
	});
	expect(stats.total.totalJumps).toBe(1);
	expect(
		(await (await page.request.get("/api/community/current")).json()).run.id,
	).not.toBe(first);
	expect(observed.errors).toEqual([]);
});
test("window blur cancels charging and keeps Community time frozen until explicit Resume", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	const observed = observe(page);
	await account(page, "pause_ui");
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu (Esc)", exact: true }),
	).toBeVisible({ timeout: 15_000 });
	await page.keyboard.down("Space");
	await page.waitForTimeout(100);
	await page.evaluate(() => window.dispatchEvent(new Event("blur")));
	await page.keyboard.up("Space");
	await expect(
		page.getByRole("button", { name: "Resume", exact: true }),
	).toBeVisible();
	await expect.poll(() => observed.snapshots.at(-1)?.self.paused).toBe(true);
	const ticks = required(observed.snapshots.at(-1)).self.simulation.physics
		.ticks;
	await page.waitForTimeout(1100);
	expect(
		required(observed.snapshots.at(-1)).self.simulation.physics.ticks,
	).toBe(ticks);
	expect(
		required(observed.snapshots.at(-1)).self.simulation.physics.jumps,
	).toBe(0);
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	await expect.poll(() => observed.snapshots.at(-1)?.generation).toBe(2);
	await jump(page);
	await expect
		.poll(() => observed.snapshots.at(-1)?.self.simulation.physics.jumps)
		.toBe(1);
	await leave(page);
	expect(observed.errors).toEqual([]);
});
test("transport disconnect reconnects the same identity and run while confirmed Leave clears its token", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	const observed = observe(page);
	await account(page, "reload_tower");
	await page.evaluate(async () => {
		const path = "/src/network/GameSocket.ts",
			{ GameSocket } = await import(path),
			connect = GameSocket.prototype.connect;
		GameSocket.prototype.connect = function () {
			Object.assign(window, { lifecycleConnection: this });
			return connect.call(this);
		};
	});
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu (Esc)", exact: true }),
	).toBeVisible({ timeout: 15_000 });
	await jump(page);
	await expect
		.poll(() => observed.snapshots.at(-1)?.self.simulation.physics.jumps)
		.toBe(1);
	const run = required(observed.snapshots.at(-1)).playId,
		generation = required(observed.snapshots.at(-1)).generation;
	await page.evaluate(() => {
		const connection = (
			window as unknown as {
				lifecycleConnection: { socket: WebSocket };
			}
		).lifecycleConnection;
		connection.socket.close(4000, "Test transport disconnect");
	});
	await expect(
		page.getByRole("button", { name: "Reconnect", exact: true }),
	).toBeVisible();
	expect(observed.leaves).toBe(0);
	await page.getByRole("button", { name: "Reconnect", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Resume", exact: true }),
	).toBeVisible({ timeout: 15_000 });
	await expect
		.poll(() => observed.snapshots.at(-1)?.generation)
		.toBeGreaterThan(generation);
	expect(required(observed.snapshots.at(-1)).playId).toBe(run);
	expect(
		required(observed.snapshots.at(-1)).self.simulation.physics.jumps,
	).toBe(1);
	await leave(page);
	const saved = await page.evaluate(async () => {
		const path = "/src/network/reconnect.ts",
			me = await (await fetch("/api/auth/me")).json();
		return (await import(path)).loadReconnect(
			`${location.origin}:account:${me.account.id}`,
		);
	});
	expect(saved).toBeNull();
	expect(observed.errors).toEqual([]);
});

test("leaving a Community page saves the run, releases membership and reload never duplicates it", async ({
	browser,
}) => {
	test.setTimeout(60000);
	const first = await browser.newContext(),
		second = await browser.newContext();
	const a = await first.newPage(),
		b = await second.newPage();
	const own = observe(a),
		peer = observe(b);
	try {
		for (const context of [first, second])
			await context.addInitScript(() => {
				if (location.protocol === "http:" || location.protocol === "https:")
					localStorage.setItem(
						"jumpking.options",
						JSON.stringify({ sound: false }),
					);
			});
		const name = await account(a, "page_tower");
		await account(b, "page_peer");
		for (const page of [a, b]) {
			await page.getByRole("button", { name: "New Game", exact: true }).click();
			await expect(
				page.getByRole("button", { name: "Menu (Esc)", exact: true }),
			).toBeVisible({ timeout: 15_000 });
		}
		await expect
			.poll(() =>
				peer.snapshots.at(-1)?.peers.some((item) => item.nickname === name),
			)
			.toBe(true);
		await a.bringToFront();
		if (
			!(await a
				.getByRole("button", { name: "Resume", exact: true })
				.isVisible())
		)
			await a.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await expect.poll(() => own.snapshots.at(-1)?.self.paused).toBe(true);
		await a.getByRole("button", { name: "Resume", exact: true }).click();
		await expect.poll(() => own.snapshots.at(-1)?.self.paused).toBe(false);
		await a.locator("canvas").click();
		await expect(a.locator("canvas")).toBeFocused();
		await jump(a);
		await expect
			.poll(() => own.snapshots.at(-1)?.self.simulation.physics.jumps)
			.toBe(1);
		await expect
			.poll(() => own.snapshots.at(-1)?.self.simulation.physics.grounded)
			.toBe(true);
		const run = required(own.snapshots.at(-1)).playId;
		await a.goto("about:blank");
		await expect
			.poll(() =>
				peer.rosters.at(-1)?.members.some((member) => member.nickname === name),
			)
			.toBe(false);
		await expect
			.poll(() =>
				peer.snapshots.at(-1)?.peers.some((item) => item.nickname === name),
			)
			.toBe(false);
		// Kiểm chứng Leave bằng roster/snapshot server vì document cũ đã bị hủy.
		await a.goto("/");
		await expect(a.getByRole("button", { name, exact: true })).toBeVisible();
		await a.getByRole("button", { name: "Continue", exact: true }).click();
		await expect(
			a.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible();
		await expect.poll(() => own.snapshots.at(-1)?.playId).toBe(run);
		expect(required(own.snapshots.at(-1)).self.simulation.physics.jumps).toBe(
			1,
		);
		await expect
			.poll(
				() =>
					peer.rosters
						.at(-1)
						?.members.filter((member) => member.nickname === name).length,
			)
			.toBe(1);
		const count = own.snapshots.length;
		await a.reload();
		await expect
			.poll(
				async () =>
					(await a
						.getByRole("button", { name: "Continue", exact: true })
						.isVisible()) ||
					(await a
						.getByRole("button", { name: "Resume", exact: true })
						.isVisible()) ||
					(await a
						.getByRole("button", { name: "Menu (Esc)", exact: true })
						.isVisible()),
			)
			.toBe(true);
		if (
			await a.getByRole("button", { name: "Continue", exact: true }).isVisible()
		)
			await a.getByRole("button", { name: "Continue", exact: true }).click();
		await expect.poll(() => own.snapshots.length).toBeGreaterThan(count);
		expect(required(own.snapshots.at(-1)).playId).toBe(run);
		expect(required(own.snapshots.at(-1)).self.simulation.physics.jumps).toBe(
			1,
		);
		await expect
			.poll(
				() =>
					peer.rosters
						.at(-1)
						?.members.filter((member) => member.nickname === name).length,
			)
			.toBe(1);
		const before = own.leaves;
		await leave(a);
		expect(own.leaves).toBe(before + 1);
		await a.evaluate(() =>
			window.dispatchEvent(new PageTransitionEvent("pagehide")),
		);
		expect(own.leaves).toBe(before + 1);
	} finally {
		await leaveOnline(a);
		await leaveOnline(b);
		await first.close();
		await second.close();
	}
});
