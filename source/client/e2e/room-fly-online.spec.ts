import { expect, test } from "@playwright/test";
import map from "../../common/maps/main-babe.json" with { type: "json" };
import physics from "../../common/physics.json" with { type: "json" };
import goals from "../../common/room-maps.json" with { type: "json" };
import type { OnlineSnapshot } from "../src/game/netcode/OnlineRuntime";
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
	process.env.E2E_ROOM_FLY !== "true",
	"Requires the local-profile Room flight harness",
);

test("Room shows the selected map name at start and keeps it through reconnect", async ({
	page,
}, info) => {
	test.setTimeout(45000);
	await page.setViewportSize({ width: 844, height: 390 });
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	try {
		const observed = observeOnline(page);
		await registerOnline(page, "region");
		await page.evaluate(async () => {
			const path = "/src/network/GameSocket.ts";
			const { GameSocket } = await import(path);
			const connect = GameSocket.prototype.connect;
			GameSocket.prototype.connect = function () {
				Object.assign(window, { regionConnection: this });
				return connect.call(this);
			};
		});
		await createRoom(page);
		await page.getByLabel("Map", { exact: true }).selectOption("9");
		await page.getByRole("button", { name: "Start", exact: true }).click();
		await expect(page.getByLabel("Play time", { exact: true })).not.toHaveText(
			"00:00 s",
			{ timeout: 15000 },
		);
		await page.locator("canvas").click();
		const caption = page.getByLabel("Current region", { exact: true });
		await expect
			.poll(() => observed.snapshot?.self.simulation.world.mapIntro?.level)
			.toBe(9);
		await expect(caption).toHaveText("The Tower");
		await expect(caption).toHaveCSS("animation-duration", "3s");
		await expect
			.poll(() =>
				caption.evaluate((element) =>
					Number(getComputedStyle(element).opacity),
				),
			)
			.toBeGreaterThan(0.1);
		const bounds = required(await caption.boundingBox());
		expect(bounds.x).toBeGreaterThanOrEqual(0);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(844);
		await page.screenshot({ path: info.outputPath("region-mobile.png") });
		await caption.evaluate(async (element) => {
			for (const animation of element.getAnimations()) animation.finish();
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		});
		await expect(caption).toHaveCSS("opacity", "0");
		const intro = structuredClone(
			required(observed.snapshot).self.simulation.world.mapIntro,
		);
		await expect
			.poll(() => observed.snapshot?.self.simulation.world.mapIntro)
			.toEqual(intro);
		await page.evaluate(() => {
			const connection = (
				window as unknown as { regionConnection: { socket: WebSocket } }
			).regionConnection;
			connection.socket.close(4000, "Test map caption reconnect");
		});
		await page.getByRole("button", { name: "Reconnect", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Resume", exact: true }),
		).toBeVisible();
		await expect
			.poll(() => observed.snapshot?.self.simulation.world.mapIntro)
			.toEqual(intro);
		await expect(caption).toHaveCount(0);
	} finally {
		await page.keyboard.up("ArrowUp");
		await page.keyboard.up("ArrowDown");
		await leaveOnline(page);
	}
});
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
			a.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		if (
			!(await a
				.getByRole("button", { name: "Resume", exact: true })
				.isVisible())
		)
			await a.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await a.getByRole("button", { name: "Resume", exact: true }).click();
		await a.keyboard.press("Space");
		await a.waitForTimeout(80);
		await a.keyboard.press("Space");
		await expect
			.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
			.toBe(true);
		const goal = required(goals[0]).finish;
		await a.keyboard.down("ArrowLeft");
		await expect
			.poll(() => snapshots.at(-1)?.self.simulation.physics.x, {
				intervals: [20],
			})
			.toBeLessThan(goal.minCenterX + map.tileSize * 5);
		await a.keyboard.up("ArrowLeft");
		await a.keyboard.down("KeyW");
		await expect
			.poll(() => snapshots.at(-1)?.self.simulation.physics.y, {
				timeout: 15_000,
				intervals: [30],
			})
			.toBeLessThan(
				map.progressOriginY -
					goal.minProgress -
					physics.bodyHeight -
					map.tileSize,
			);
		await a.keyboard.up("KeyW");
		await expect
			.poll(() => snapshots.at(-1)?.self.simulation.physics.vy)
			.toBe(0);
		// Đáp đúng nền Finish; không rơi lên nền cao hơn khi Fly vượt đích.
		const landingY =
			map.progressOriginY -
			goal.minProgress -
			physics.bodyHeight -
			map.tileSize * 4;
		for (let attempt = 0; attempt < 12; attempt++) {
			const state = required(snapshots.at(-1)).self.simulation.physics;
			if (Math.abs(state.y - landingY) <= physics.flyVerticalSpeed) break;
			await a.keyboard.press(state.y < landingY ? "ArrowDown" : "ArrowUp", {
				delay: 20,
			});
			const releasedAt = required(snapshots.at(-1)).self.simulation.physics
				.ticks;
			await expect
				.poll(() => {
					const current = required(snapshots.at(-1)).self.simulation.physics;
					return current.ticks > releasedAt && current.vy === 0;
				})
				.toBe(true);
		}
		expect(
			Math.abs(required(snapshots.at(-1)).self.simulation.physics.y - landingY),
		).toBeLessThanOrEqual(physics.flyVerticalSpeed);
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
			a.getByText("Map 1 · Green Woods", { exact: true }),
		).toBeVisible();
		await expect(
			a.getByRole("button", { name: "Skip", exact: true }),
		).toBeHidden();
		expect(finishes).toEqual([]);
		const history = (await (await a.request.get("/api/history")).json())
			.items[0];
		expect(history.room.mapId).toBe(1);
		const stats = (await (await a.request.get("/api/profile/me")).json()).total;
		expect(stats.finishes).toBe(1);
		expect(stats.matchesPlayed).toBe(1);
		expect(stats.bestFinishTimeMs).toBeNull();
		expect(
			(await (await a.request.get("/api/auth/me")).json()).account.crown,
		).toBe("NONE");
		await a.screenshot({ path: info.outputPath("short-room-results.png") });
		await a.getByRole("button", { name: "Play Again", exact: true }).click();
		await expect(a.getByLabel("Map", { exact: true })).toHaveValue("1");
		await expect(a.locator(".room-code code")).toHaveText(id);
		await b.getByRole("button", { name: "Leave", exact: true }).click();
		await a.getByRole("button", { name: "Leave", exact: true }).click();
		await a.locator(".account-actions button").click();
		await a.getByRole("button", { name: "History", exact: true }).click();
		await a.locator(".history-list > button").first().click();
		await expect(a.getByText("1 · Green Woods", { exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	} finally {
		for (const context of [first, second])
			for (const page of context.pages()) await leaveOnline(page);
		await first.close();
		await second.close();
	}
});
for (const mode of ["RACE", "HARDCORE", "NO_WALK"])
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
				a.getByRole("button", { name: "Menu (Esc)", exact: true }),
			).toBeVisible({ timeout: 15_000 });
			if (
				!(await a
					.getByRole("button", { name: "Resume", exact: true })
					.isVisible())
			)
				await a
					.getByRole("button", { name: "Menu (Esc)", exact: true })
					.click();
			await a.getByRole("button", { name: "Resume", exact: true }).click();
			await a.keyboard.press("Space");
			await a.waitForTimeout(80);
			await a.keyboard.press("Space");
			await expect
				.poll(() => snapshots.at(-1)?.self.simulation.physics.freeFlight)
				.toBe(true);
			const y = required(snapshots.at(-1)).self.simulation.physics.y;
			await a.waitForTimeout(400);
			await a.keyboard.down("KeyW");
			await a.waitForTimeout(200);
			await a.keyboard.up("KeyW");
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
				expect(
					required(snapshots.at(-1)).self.simulation.physics.freeFlight,
				).toBe(false);
				await a.bringToFront();
			}
			if (
				!(await a
					.getByRole("button", { name: "End Match", exact: true })
					.isVisible())
			)
				await a
					.getByRole("button", { name: "Menu (Esc)", exact: true })
					.click();
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
