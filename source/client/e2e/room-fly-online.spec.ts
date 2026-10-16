import { expect, test } from "@playwright/test";
import type { OnlineSnapshot } from "../src/game/netcode/OnlineRuntime";
import {
	createRoom,
	joinRoom,
	leaveOnline,
	observeOnline,
	registerOnline,
	startRoom,
} from "./support/online";

test.skip(
	process.env.E2E_ROOM_FLY !== "true",
	"Requires the local-profile Room flight harness",
);
test("short Room finish shows Results and History without ending or full-map rewards", async ({
	browser,
}, info) => {
	test.setTimeout(45_000);
	const first = await browser.newContext(),
		second = await browser.newContext();
	try {
		for (const context of [first, second])
			await context.addInitScript(() =>
				localStorage.setItem(
					"jumpking.options",
					JSON.stringify({ sound: false }),
				),
			);
		const a = await first.newPage(),
			b = await second.newPage(),
			snapshots: OnlineSnapshot[] = [],
			finishes: unknown[] = [],
			errors: string[] = [];
		for (const page of [a, b])
			page.on("pageerror", (error) => errors.push(error.message));
		a.on("websocket", (socket) =>
			socket.on("framereceived", (frame) => {
				const message = JSON.parse(frame.payload.toString());
				if (message.type === "GAME_SNAPSHOT") snapshots.push(message.payload);
				if (message.type === "PLAYER_FINISHED") finishes.push(message.payload);
			}),
		);
		const hostName = await registerOnline(a, "fly_host");
		await registerOnline(b, "fly_peer");
		await createRoom(a);
		await a.getByLabel("Map", { exact: true }).selectOption("1");
		await expect(a.getByLabel("Map", { exact: true })).toHaveValue("1");
		const id = await a.locator(".room-code code").innerText();
		await joinRoom(b, id);
		await a.bringToFront();
		await startRoom(a, b);
		await expect(
			a.getByRole("button", { name: "Menu", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		if (
			!(await a
				.getByRole("button", { name: "Resume", exact: true })
				.isVisible())
		)
			await a.getByRole("button", { name: "Menu", exact: true }).click();
		await a.getByRole("button", { name: "Resume", exact: true }).click();
		await a.keyboard.press("Space");
		await a.waitForTimeout(80);
		await a.keyboard.press("Space");
		await expect
			.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
			.toBe(true);
		await a.keyboard.down("ArrowLeft");
		await expect
			.poll(() => snapshots.at(-1)?.self.simulation.physics.x, {
				intervals: [20],
			})
			.toBeLessThan(70);
		await a.keyboard.up("ArrowLeft");
		await a.keyboard.down("Space");
		await expect
			.poll(() => snapshots.at(-1)?.self.simulation.physics.y, {
				timeout: 15_000,
				intervals: [30],
			})
			.toBeLessThan(-1790);
		await a.keyboard.up("Space");
		await a.screenshot({ path: info.outputPath("room-map-1-finish.png") });
		await a.waitForTimeout(400);
		await a.keyboard.press("Space");
		await a.waitForTimeout(80);
		await a.keyboard.press("Space");
		await expect(
			a.getByRole("button", { name: "Play Again", exact: true }),
		).toBeEnabled({ timeout: 10_000 });
		await expect(a.locator(".winner")).toContainText(hostName);
		await expect(
			a.getByText("Map 1 · Redcrown Woods", { exact: true }),
		).toBeVisible();
		await expect(
			a.getByRole("button", { name: "Skip", exact: true }),
		).toBeHidden();
		expect(finishes).toEqual([]);
		const history = (await (await a.request.get("/api/history")).json())
			.items[0];
		expect(history.room.mapLevel).toBe(1);
		const stats = (await (await a.request.get("/api/profile/me")).json()).total;
		expect(stats.finishes).toBe(1);
		expect(stats.wins).toBe(1);
		expect(stats.bestFinishTimeMs).toBeNull();
		expect(
			(await (await a.request.get("/api/auth/me")).json()).crownUnlocked,
		).toBe(false);
		await a.screenshot({ path: info.outputPath("short-room-results.png") });
		await a.getByRole("button", { name: "Play Again", exact: true }).click();
		await expect(a.getByLabel("Map", { exact: true })).toHaveValue("1");
		await expect(a.locator(".room-code code")).toHaveText(id);
		await b.getByRole("button", { name: "Leave", exact: true }).click();
		await a.getByRole("button", { name: "Leave", exact: true }).click();
		await a.getByRole("button", { name: "History", exact: true }).click();
		await a.locator(".history-list > button").first().click();
		await expect(
			a.getByText("1 · Redcrown Woods", { exact: true }),
		).toBeVisible();
		expect(errors).toEqual([]);
	} finally {
		for (const context of [first, second])
			for (const page of context.pages()) await leaveOnline(page);
		await first.close();
		await second.close();
	}
});
for (const mode of ["RACE", "HARDCORE", "TIME_LIMIT", "NO_WALK"])
	test(`two browsers can enable and cancel flight in ${mode}`, async ({
		browser,
	}) => {
		const first = await browser.newContext(),
			second = await browser.newContext();
		try {
			for (const context of [first, second])
				await context.addInitScript(() => {
					if (location.protocol.startsWith("http"))
						localStorage.setItem(
							"jumpking.options",
							JSON.stringify({ sound: false }),
						);
				});
			const a = await first.newPage(),
				b = await second.newPage(),
				snapshots: OnlineSnapshot[] = [],
				errors: unknown[] = [];
			const peer = observeOnline(b);
			for (const page of [a, b])
				page.on("pageerror", (error) => errors.push(error.message));
			a.on("websocket", (socket) =>
				socket.on("framereceived", (frame) => {
					const message = JSON.parse(frame.payload.toString());
					if (message.type === "GAME_SNAPSHOT") snapshots.push(message.payload);
					if (message.type === "ERROR") errors.push(message.payload);
				}),
			);
			await registerOnline(a, "fly_host");
			await registerOnline(b, "fly_peer");
			await createRoom(a);
			await a.getByLabel("Mode", { exact: true }).selectOption(mode);
			const room = await a.locator(".room-code code").innerText();
			await joinRoom(b, room);
			await a.bringToFront();
			await startRoom(a, b);
			await expect(
				a.getByRole("button", { name: "Menu", exact: true }),
			).toBeVisible({ timeout: 15_000 });
			if (
				!(await a
					.getByRole("button", { name: "Resume", exact: true })
					.isVisible())
			)
				await a.getByRole("button", { name: "Menu", exact: true }).click();
			await a.getByRole("button", { name: "Resume", exact: true }).click();
			await a.keyboard.press("Space");
			await a.waitForTimeout(80);
			await a.keyboard.press("Space");
			await expect
				.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
				.toBe(true);
			const y = snapshots.at(-1)!.self.simulation.physics.y;
			await a.waitForTimeout(400);
			await a.keyboard.down("Space");
			await a.waitForTimeout(200);
			await a.keyboard.up("Space");
			await a.waitForTimeout(400);
			await expect
				.poll(() => snapshots.at(-1)?.self.simulation.physics.y)
				.toBeLessThan(y - 20);
			await a.keyboard.press("Space");
			await a.waitForTimeout(80);
			await a.keyboard.press("Space");
			await expect
				.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
				.toBe(false);
			if (mode === "RACE") {
				await b.bringToFront();
				if (
					await b
						.getByRole("button", { name: "Resume", exact: true })
						.isVisible()
				)
					await b.getByRole("button", { name: "Resume", exact: true }).click();
				await b.locator("canvas").click();
				await b.keyboard.press("Space");
				await b.waitForTimeout(80);
				await b.keyboard.press("Space");
				await expect
					.poll(() => peer.snapshot?.self.simulation.physics.freeFlight)
					.toBe(true);
				expect(snapshots.at(-1)!.self.simulation.physics.freeFlight).toBe(
					false,
				);
				await a.bringToFront();
			}
			if (
				!(await a
					.getByRole("button", { name: "End Match", exact: true })
					.isVisible())
			)
				await a.getByRole("button", { name: "Menu", exact: true }).click();
			await a.getByRole("button", { name: "End Match", exact: true }).click();
			await expect(
				a.getByRole("button", { name: "Play Again", exact: true }),
			).toBeEnabled();
			const history = (await (await a.request.get("/api/history")).json())
				.items;
			expect(history[0].room.mode).toBe(mode);
			expect(history[0].maxProgress).toBeGreaterThan(20);
			expect(errors).toEqual([]);
			await a.getByRole("button", { name: "Leave", exact: true }).click();
			await b.getByRole("button", { name: "Leave", exact: true }).click();
		} finally {
			for (const context of [first, second])
				for (const page of context.pages()) await leaveOnline(page);
			await first.close();
			await second.close();
		}
	});
