import { expect, type Page, test } from "@playwright/test";
import { required } from "../src/required";
import {
	createRoom,
	joinRoom,
	leaveOnline,
	newCommunity,
	observeOnline,
	registerOnline,
	startRoom,
} from "./support/online";

test.skip(
	process.env.E2E_SPECTATE_ONLINE !== "true",
	"Requires the isolated spectator integration harness",
);

async function resume(page: Page) {
	await page.bringToFront();
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	const button = page.getByRole("button", { name: "Resume", exact: true });
	await button.click();
	await page.locator("canvas").click();
}
// Quan sát frame renderer thật; không thay đổi simulation hoặc input của ứng dụng.
async function observeView(page: Page) {
	await page.evaluate(async () => {
		const path = "/src/game/netcode/OnlineRuntime.ts";
		const { OnlineRuntime } = await import(path);
		const frame = OnlineRuntime.prototype.frame;
		OnlineRuntime.prototype.frame = function () {
			const result = frame.call(this);
			const canvas = document.querySelector("canvas");
			canvas?.setAttribute("data-view-player", result.self.id);
			canvas?.setAttribute(
				"data-view-screen",
				String(result.self.state.screen),
			);
			return result;
		};
	});
}

// Giữ ACK ở phía UI để tái hiện ESC tới trong lúc đang đổi camera.
async function delayNextSpectateAck(page: Page) {
	await page.evaluate(async () => {
		const path = "/src/network/GameSocket.ts";
		const { GameSocket } = await import(path);
		const command = GameSocket.prototype.command;
		let waiting = true;
		const gate = new Promise<void>((resolve) => {
			(
				window as unknown as { releaseSpectateAck: () => void }
			).releaseSpectateAck = resolve;
		});
		GameSocket.prototype.command = async function (
			type: string,
			payload: Record<string, unknown>,
		) {
			const reply = await command.call(this, type, payload);
			if (type === "SET_SPECTATE" && waiting) {
				waiting = false;
				await gate;
			}
			return reply;
		};
	});
}
for (const kind of ["COMMUNITY", "ROOM"] as const)
	test(`${kind} follows a distant player across screens, blocks input and returns to the viewer`, async ({
		browser,
	}, info) => {
		test.setTimeout(60000);
		const first = await browser.newContext(),
			second = await browser.newContext({
				viewport: { width: 844, height: 390 },
				isMobile: true,
				hasTouch: true,
			});
		const target = await first.newPage(),
			viewer = await second.newPage();
		const targetState = observeOnline(target),
			ownState = observeOnline(viewer),
			errors: string[] = [];
		for (const page of [target, viewer])
			page.on("pageerror", (e) => errors.push(e.message));
		try {
			const name = await registerOnline(target, "watch_target");
			const ownName = await registerOnline(viewer, "watch_viewer");
			if (kind === "COMMUNITY") {
				await target.bringToFront();
				await newCommunity(target);
				await target
					.getByRole("button", { name: "Menu (Esc)", exact: true })
					.click();
				await expect.poll(() => targetState.snapshot?.self.paused).toBe(true);
				await viewer.bringToFront();
				await newCommunity(viewer);
				await viewer
					.getByRole("button", { name: "Menu (Esc)", exact: true })
					.click();
				await expect.poll(() => ownState.snapshot?.self.paused).toBe(true);
			} else {
				const code = await createRoom(target);
				await joinRoom(viewer, code);
				await startRoom(target, viewer);
			}
			await observeView(viewer);
			await resume(target);
			await target.keyboard.press("Space");
			await target.keyboard.press("Space");
			await expect
				.poll(() => targetState.snapshot?.self.simulation.physics.freeFlight)
				.toBe(true);
			await target.keyboard.down("ArrowUp");
			try {
				await expect
					.poll(() => targetState.snapshot?.self.simulation.physics.screen)
					.toBeGreaterThanOrEqual(3);
			} finally {
				await target.keyboard.up("ArrowUp");
			}
			const targetId = required(targetState.snapshot).players?.find(
				(p) => p.nickname === name,
			)?.playerId;
			await resume(viewer);
			const run = required(ownState.snapshot).playId;
			await viewer
				.getByRole("button", { name: `Watch ${name}`, exact: true })
				.click();
			await expect(
				viewer.getByRole("button", { name: "Back to My Game", exact: true }),
			).toBeVisible();
			const stage = await viewer.locator(".game-stage").boundingBox(),
				chat = await viewer.locator(".game-chat").boundingBox(),
				back = await viewer
					.getByRole("button", { name: "Back to My Game", exact: true })
					.boundingBox();
			if (!stage || !chat || !back)
				throw new Error("Spectator controls are missing");
			expect(back.x).toBeGreaterThanOrEqual(0);
			expect(back.y).toBeGreaterThanOrEqual(0);
			expect(back.x + back.width).toBeLessThanOrEqual(stage.x);
			expect(back.y + back.height).toBeLessThanOrEqual(chat.y);
			await expect(viewer.locator("canvas")).toHaveAttribute(
				"data-view-player",
				required(targetId),
			);
			await expect
				.poll(() => Number(ownState.snapshot?.spectating?.player.state.screen))
				.toBeGreaterThanOrEqual(3);
			const screen = required(ownState.snapshot?.spectating).player.state
				.screen;
			await expect(viewer.locator("canvas")).toHaveAttribute(
				"data-view-screen",
				String(screen),
			);
			const own = required(ownState.snapshot).self.simulation.physics;
			const elapsed = required(ownState.snapshot).elapsedTimeMs;
			await expect
				.poll(() => ownState.snapshot?.elapsedTimeMs ?? 0)
				.toBeGreaterThan(elapsed + 1000);
			await viewer.keyboard.press("d");
			await viewer.keyboard.press("Space");
			await expect(
				viewer.getByRole("button", { name: "Jump", exact: true }),
			).toBeHidden();
			expect(required(ownState.snapshot).playId).toBe(run);
			if (kind === "COMMUNITY") {
				await expect.poll(() => ownState.snapshot?.self.paused).toBe(false);
				expect(required(ownState.snapshot).self.simulation.physics.x).toBe(
					own.x,
				);
			}
			await viewer.screenshot({
				path: info.outputPath(`${kind.toLowerCase()}-watching-mobile.png`),
			});
			await resume(target);
			await target.keyboard.down("ArrowUp");
			try {
				await expect
					.poll(() => targetState.snapshot?.self.simulation.physics.screen)
					.toBeGreaterThan(screen);
			} finally {
				await target.keyboard.up("ArrowUp");
			}
			await viewer.bringToFront();
			// Resume giao diện phải giữ mục tiêu đang xem.
			const button = viewer.getByRole("button", {
				name: "Resume",
				exact: true,
			});
			if (await button.isVisible()) await button.click();
			await expect
				.poll(async () =>
					Number(
						await viewer.locator("canvas").getAttribute("data-view-screen"),
					),
				)
				.not.toBe(screen);
			await viewer.keyboard.press("Escape");
			await expect(button).toBeVisible();
			await button.click();
			await expect(viewer.locator("canvas")).toHaveAttribute(
				"data-view-player",
				required(targetId),
			);
			await delayNextSpectateAck(viewer);
			await viewer
				.getByRole("button", { name: `Watch ${ownName}`, exact: true })
				.click();
			await viewer.keyboard.press("Escape");
			await expect(button).toBeVisible();
			await viewer.evaluate(() =>
				(
					window as unknown as { releaseSpectateAck: () => void }
				).releaseSpectateAck(),
			);
			await expect(button).toBeEnabled();
			await expect(button).toBeVisible();
			await button.click();
			await expect(
				viewer.getByRole("button", { name: "Back to My Game", exact: true }),
			).toBeHidden();
			await expect.poll(() => ownState.snapshot?.spectating).toBeNull();
			expect(required(ownState.snapshot).playId).toBe(run);
			await viewer.locator("canvas").click();
			await viewer.keyboard.down("Space");
			try {
				await expect
					.poll(() => ownState.snapshot?.self.simulation.physics.charge)
					.toBeGreaterThan(0);
			} finally {
				await viewer.keyboard.up("Space");
			}
			await expect
				.poll(() => ownState.snapshot?.self.simulation.physics.jumps)
				.toBeGreaterThan(own.jumps);
			expect(errors).toEqual([]);
		} finally {
			for (const page of [target, viewer]) await leaveOnline(page);
			await first.close();
			await second.close();
		}
	});
