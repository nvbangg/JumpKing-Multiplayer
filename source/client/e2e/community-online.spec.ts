import { expect, type Page, test } from "@playwright/test";
import type { OnlineSnapshot } from "../src/game/netcode/OnlineRuntime";
import { leaveOnline } from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);
test.afterEach(async ({ page }) => {
	await leaveOnline(page);
});
async function account(page: Page, prefix: string) {
	const name =
		prefix + "_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
	await page.goto("/");
	await page
		.getByRole("button", { name: "Create Account", exact: true })
		.click();
	await page.getByLabel("Username", { exact: true }).fill(name);
	await page
		.getByLabel("Password", { exact: true })
		.fill("A secure Community test password");
	await page
		.getByRole("button", { name: "Create Account", exact: true })
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
	} = { snapshots: [], rosters: [], errors: [] };
	page.on("websocket", (socket) => {
		if (new URL(socket.url()).pathname !== "/ws/game") return;
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
			{ AudioBus } = await import(path);
		const original = AudioBus.prototype.effect;
		const calls: { effect: string; volume: number }[] = [];
		Object.assign(window, { onlineSoundCalls: calls });
		AudioBus.prototype.effect = function (
			effect: string,
			state: { snow: boolean; ice: boolean },
			volume: number,
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
		await page.getByRole("button", { name: "Menu", exact: true }).click();
	await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "New Solo Game", exact: true }),
	).toBeVisible();
}
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
		await a
			.getByRole("button", { name: "Community Tower", exact: true })
			.click();
		await a.getByRole("button", { name: "New Game", exact: true }).click();
		await expect(
			a.getByRole("button", { name: "Menu", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect.poll(() => observedA.snapshots.length).toBeGreaterThan(0);
		const runId = observedA.snapshots.at(-1)!.playId;
		await b
			.getByRole("button", { name: "Community Tower", exact: true })
			.click();
		await b.getByRole("button", { name: "New Game", exact: true }).click();
		await expect(
			b.getByRole("button", { name: "Menu", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect.poll(() => observedA.rosters.at(-1)?.members.length).toBe(2);
		await expect.poll(() => observedB.rosters.at(-1)?.members.length).toBe(2);
		expect(
			observedA.rosters
				.at(-1)!
				.members.map((member) => member.nickname)
				.sort(),
		).toEqual([nameA, nameB].sort());
		expect(
			new Set(
				observedA.rosters.at(-1)!.members.map((member) => member.colorSlot),
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
			observedB.snapshots.at(-1)!.players!.map((player) => player.rank),
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
		expect(observedA.snapshots.at(-1)!.peers[0]!.state).not.toHaveProperty(
			"directions",
		);
		expect(observedA.snapshots.at(-1)!.peers[0]).not.toHaveProperty(
			"adventure",
		);
		await a.bringToFront();
		if (
			await a.getByRole("button", { name: "Resume", exact: true }).isVisible()
		)
			await a.getByRole("button", { name: "Open Chat", exact: true }).click();
		else await a.getByRole("button", { name: "Chat", exact: true }).click();
		const text = '<img src=x onerror="window.chatInjected=true"> hello';
		await a.getByLabel("Message", { exact: true }).fill(text);
		await a.getByRole("button", { name: "Send", exact: true }).click();
		await expect(a.getByRole("log")).toContainText(text);
		expect(await a.evaluate(() => "chatInjected" in window)).toBe(false);
		await a.getByRole("button", { name: "Close chat", exact: true }).click();
		await b.bringToFront();
		if (
			await b.getByRole("button", { name: "Resume", exact: true }).isVisible()
		)
			await b.getByRole("button", { name: "Open Chat", exact: true }).click();
		else await b.getByRole("button", { name: "Chat", exact: true }).click();
		await expect(b.getByRole("log")).toContainText(text);
		await b.getByRole("button", { name: "Close chat", exact: true }).click();
		expect(observedA.errors).toEqual([]);
		expect(observedB.errors).toEqual([]);
		await a.screenshot({ path: info.outputPath("community-two-players.png") });
		await leave(a);
		const saved = await (await a.request.get("/api/community/current")).json();
		expect(saved.run.id).toBe(runId);
		expect(saved.run.elapsedTimeMs).toBeGreaterThan(0);
		expect(saved).not.toHaveProperty("snapshot");
		await expect.poll(() => observedB.rosters.at(-1)?.members.length).toBe(1);
		await a
			.getByRole("button", { name: "Community Tower", exact: true })
			.click();
		await a.getByRole("button", { name: "Continue", exact: true }).click();
		await expect(
			a.getByRole("button", { name: "Menu", exact: true }),
		).toBeVisible();
		await expect.poll(() => observedA.snapshots.at(-1)?.playId).toBe(runId);
		expect(
			observedA.snapshots.at(-1)!.self.simulation.physics.jumps,
		).toBeGreaterThan(0);
		await a.getByRole("button", { name: "Chat", exact: true }).click();
		await expect(a.getByRole("log")).toContainText(text);
		await a.getByRole("button", { name: "Close chat", exact: true }).click();
		await leave(a);
		await leave(b);
		await a
			.getByRole("button", { name: "Community Tower", exact: true })
			.click();
		await a.getByRole("button", { name: "Leaderboard", exact: true }).click();
		const entries = (
			await (await a.request.get("/api/leaderboard?limit=100")).json()
		).entries;
		const best = entries.find(
			(entry: { username: string }) => entry.username === nameA,
		);
		expect(best.id).toBe(runId);
		const row = a
			.getByLabel("Community leaderboard")
			.getByRole("listitem")
			.filter({ hasText: nameA });
		await expect(row).toHaveCount(1);
		await expect(row).toContainText(best.rank + ". " + nameA);
		await expect(row).toContainText(Math.floor(best.maxProgress) + " px");
		await a.getByRole("button", { name: "Back", exact: true }).click();
		await a.getByRole("button", { name: "Back", exact: true }).click();
		await expect(
			a.getByRole("button", { name: "Leaderboard", exact: true }),
		).toBeHidden();
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
	await page
		.getByRole("button", { name: "Community Tower", exact: true })
		.click();
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await page.waitForTimeout(500);
	await jump(page);
	await expect
		.poll(() => observed.snapshots.at(-1)?.self.simulation.physics.jumps)
		.toBe(1);
	await page.getByRole("button", { name: "Menu", exact: true }).click();
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
	await page
		.getByRole("button", { name: "Community Tower", exact: true })
		.click();
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await expect.poll(() => observed.snapshots.length).toBeGreaterThan(0);
	const first = observed.snapshots.at(-1)!.playId;
	await jump(page);
	await expect
		.poll(() => observed.snapshots.at(-1)?.self.simulation.physics.jumps)
		.toBe(1);
	await leave(page);
	await page
		.getByRole("button", { name: "Community Tower", exact: true })
		.click();
	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect.poll(() => observed.snapshots.at(-1)?.playId).not.toBe(first);
	expect(observed.snapshots.at(-1)!.self.simulation.physics.jumps).toBe(0);
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
	await page
		.getByRole("button", { name: "Community Tower", exact: true })
		.click();
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible({ timeout: 15_000 });
	await page.keyboard.down("Space");
	await page.waitForTimeout(100);
	await page.evaluate(() => window.dispatchEvent(new Event("blur")));
	await page.keyboard.up("Space");
	await expect(
		page.getByRole("button", { name: "Resume", exact: true }),
	).toBeVisible();
	await expect.poll(() => observed.snapshots.at(-1)?.self.paused).toBe(true);
	const ticks = observed.snapshots.at(-1)!.self.simulation.physics.ticks;
	await page.waitForTimeout(1100);
	expect(observed.snapshots.at(-1)!.self.simulation.physics.ticks).toBe(ticks);
	expect(observed.snapshots.at(-1)!.self.simulation.physics.jumps).toBe(0);
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	await expect.poll(() => observed.snapshots.at(-1)?.generation).toBe(2);
	await jump(page);
	await expect
		.poll(() => observed.snapshots.at(-1)?.self.simulation.physics.jumps)
		.toBe(1);
	await leave(page);
	expect(observed.errors).toEqual([]);
});
test("reload reconnects the same identity and run from IndexedDB and confirmed Leave clears its token", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	const observed = observe(page);
	await account(page, "reload_tower");
	await page
		.getByRole("button", { name: "Community Tower", exact: true })
		.click();
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible({ timeout: 15_000 });
	await jump(page);
	await expect
		.poll(() => observed.snapshots.at(-1)?.self.simulation.physics.jumps)
		.toBe(1);
	const run = observed.snapshots.at(-1)!.playId,
		generation = observed.snapshots.at(-1)!.generation;
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Resume", exact: true }),
	).toBeVisible({ timeout: 15_000 });
	await expect
		.poll(() => observed.snapshots.at(-1)?.generation)
		.toBeGreaterThan(generation);
	expect(observed.snapshots.at(-1)!.playId).toBe(run);
	expect(observed.snapshots.at(-1)!.self.simulation.physics.jumps).toBe(1);
	await leave(page);
	const saved = await page.evaluate(async () => {
		const path = "/src/network/reconnect.ts",
			me = await (await fetch("/api/auth/me")).json();
		return (await import(path)).loadReconnect(
			location.origin + ":account:" + me.account.id,
		);
	});
	expect(saved).toBeNull();
	expect(observed.errors).toEqual([]);
});
