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

test("Room countdown conceals walls and every new stage keeps its spawn after Start", async ({
	page,
}, info) => {
	test.setTimeout(120000);
	const observed = observeOnline(page);
	try {
		await registerOnline(page, "spawn");
		for (let level = 3; level <= goals.length; level++) {
			const roomId = await createRoom(page);
			await page.getByLabel("Map", { exact: true }).selectOption(String(level));
			const expected = await page.evaluate(
				async ({ map, level }) => {
					const path = "/src/game/simulation/roomMaps.ts";
					const { ROOM_MAPS, roomMap } = await import(path);
					const floorPath = "/src/game/simulation/finishPlatform.ts";
					const { findFinishPlatform } = await import(floorPath);
					const platform = findFinishPlatform({
						...map,
						finish: ROOM_MAPS[level - 2].finish,
					});
					return {
						spawn: roomMap(map, level).spawn,
						left: platform.x,
						right: platform.x + platform.width,
					};
				},
				{ map, level },
			);
			await page.getByRole("button", { name: "Start", exact: true }).click();
			await expect(
				page.getByRole("button", { name: "Menu (Esc)", exact: true }),
			).toBeVisible();
			if (level === 3)
				await page.screenshot({
					path: info.outputPath("room-countdown-walls.png"),
				});
			await expect.poll(() => observed.snapshot?.roomId).toBe(roomId);
			await expect
				.poll(() => observed.snapshot?.self.simulation.physics.ticks ?? 0)
				.toBeGreaterThan(0);
			expect(required(observed.snapshot).self.simulation.physics).toMatchObject(
				{ y: expected.spawn.y, falls: 0 },
			);
			if (
				await page
					.getByRole("button", { name: "Resume", exact: true })
					.isVisible()
			)
				await page.getByRole("button", { name: "Resume", exact: true }).click();
			await expect
				.poll(() => observed.snapshot?.self.simulation.physics.ticks ?? 0, {
					timeout: 15000,
				})
				.toBeGreaterThan(physics.tickRate * 2);
			expect(required(observed.snapshot).self.simulation.physics).toMatchObject(
				{ y: expected.spawn.y, falls: 0 },
			);
			const position = required(observed.snapshot).self.simulation.physics;
			expect(position.x).toBeGreaterThanOrEqual(expected.left);
			expect(position.x + physics.bodyWidth).toBeLessThanOrEqual(
				expected.right,
			);
			const caption = page.getByLabel("Current region", { exact: true });
			await expect(caption).toHaveCSS("animation-duration", "6s");
			await page
				.getByRole("button", { name: "Menu (Esc)", exact: true })
				.click();
			await page
				.getByRole("button", { name: "Leave Room", exact: true })
				.click();
		}
	} finally {
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
		await expect(
			a
				.getByRole("row")
				.filter({ hasText: hostName })
				.getByRole("cell")
				.first(),
		).toHaveText("1");
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
		expect(stats.finishes).toBe(0);
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
		await a.locator(".history-rows > button").first().click();
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
			expect(history[0].maxProgress).toBe(0);
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
