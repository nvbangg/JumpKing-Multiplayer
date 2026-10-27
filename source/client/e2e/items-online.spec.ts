import { expect, test } from "@playwright/test";
import {
	joinRoom,
	leaveOnline,
	observeOnline,
	registerOnline,
	startRoom,
} from "./support/online";

test.skip(
	process.env.E2E_ITEMS_ONLINE !== "true",
	"Requires isolated item integration harness",
);
for (const mobile of [false, true])
	test(`Room items creation, use and cooldown (${mobile ? "mobile" : "desktop"})`, async ({
		browser,
	}, info) => {
		test.setTimeout(50000);
		const first = await browser.newContext(
			mobile
				? {
						viewport: { width: 390, height: 844 },
						hasTouch: true,
						isMobile: true,
					}
				: {},
		);
		const second = await browser.newContext();
		const host = await first.newPage(),
			peer = await second.newPage();
		const own = observeOnline(host),
			other = observeOnline(peer);
		const errors: string[] = [];
		let seenSlip = false,
			seenRock = false,
			usedItems = 0;
		for (const page of [host, peer]) {
			page.on("pageerror", (e) => errors.push(e.message));
			page.on("websocket", (socket) =>
				socket.on("framereceived", (frame) => {
					const m = JSON.parse(frame.payload.toString());
					if (m.type === "GAME_SNAPSHOT") {
						seenSlip ||= m.payload.self?.simulation?.physics?.slipping === true;
						seenRock ||= m.payload.items?.rocks?.length > 0;
					}
				}),
			);
		}
		host.on("websocket", (socket) =>
			socket.on("framesent", (frame) => {
				if (JSON.parse(frame.payload.toString()).type === "USE_ITEM")
					usedItems++;
			}),
		);
		try {
			await registerOnline(host, "item_host");
			await registerOnline(peer, "item_peer");
			await expect(host.getByLabel("Items", { exact: true })).toHaveCount(0);
			await host
				.getByRole("button", { name: "Create Room", exact: true })
				.click();
			const id = (await host.locator(".room-code code").innerText()).trim();
			await expect(
				host.getByLabel("Items cooldown", { exact: true }),
			).toHaveValue("OFF");
			await joinRoom(peer, id);
			await expect(
				peer.getByLabel("Items cooldown", { exact: true }),
			).toBeDisabled();
			await expect(host.locator(".menu-panel .chat-panel")).toHaveCount(0);
			await expect(host.locator(".chat-panel")).toBeVisible();
			await host.locator("body").click({ position: { x: 1, y: 1 } });
			await host.keyboard.press("Enter");
			await expect(host.getByLabel("Message", { exact: true })).toBeFocused();
			await host.getByLabel("Message", { exact: true }).fill("Ready to play");
			await host.keyboard.press("Enter");
			await expect(peer.getByRole("log")).toContainText("Ready to play");
			await peer.getByLabel("Message", { exact: true }).fill("Ready too");
			await peer.getByRole("button", { name: "Send", exact: true }).click();
			await expect(host.getByRole("log")).toContainText("Ready too");
			await expect(host.getByLabel("Message", { exact: true })).toBeVisible();
			await host
				.getByLabel("Items cooldown", { exact: true })
				.selectOption("3");
			await expect(
				peer.getByLabel("Items cooldown", { exact: true }),
			).toHaveValue("3");
			await host
				.getByLabel("Items cooldown", { exact: true })
				.selectOption("1");
			await expect(
				peer.getByLabel("Items cooldown", { exact: true }),
			).toHaveValue("1");
			await host.getByLabel("Map", { exact: true }).selectOption("1");
			const chatBounds = await host.locator(".chat-panel").boundingBox(),
				menuBounds = await host.locator(".menu-panel").boundingBox();
			if (!chatBounds || !menuBounds)
				throw new Error("Lobby panels are missing");
			const lobbyViewport = host.viewportSize();
			if (!lobbyViewport) throw new Error("Viewport is missing");
			expect(chatBounds.x).toBeLessThan(lobbyViewport.width / 4);
			expect(chatBounds.x).toBeGreaterThanOrEqual(0);
			expect(chatBounds.x + chatBounds.width).toBeLessThanOrEqual(
				lobbyViewport.width,
			);
			expect(chatBounds.y + chatBounds.height).toBeLessThanOrEqual(
				await host.evaluate(() => document.documentElement.scrollHeight),
			);
			expect(
				mobile
					? menuBounds.y + menuBounds.height <= chatBounds.y
					: chatBounds.x + chatBounds.width <= menuBounds.x,
			).toBe(true);
			await host.screenshot({
				path: info.outputPath(
					mobile ? "lobby-mobile.png" : "lobby-desktop.png",
				),
			});
			if (mobile) {
				await host.setViewportSize({ width: 844, height: 390 });
				await host.getByLabel("Time Limit", { exact: true }).selectOption("1");
			}
			await startRoom(host, peer);
			const viewport = host.viewportSize();
			await expect
				.poll(() => own.snapshot?.items?.held)
				.toMatch(/BANANA|ROCK|BOOTS/);
			const kind = own.snapshot?.items?.held;
			const button = host.getByRole("button", {
				name: "Use item",
				exact: true,
			});
			await expect(button).toBeEnabled();
			const expectItemLayout = async () => {
				await expect(async () => {
					const layout = await host
						.locator(".play-page")
						.evaluate((root, mobile) => {
							const bounds = (selector: string) => {
								const element = root.querySelector(selector);
								if (!element) throw new Error(`Missing ${selector}`);
								const { x, y, width, right, bottom } =
									element.getBoundingClientRect();
								return { x, y, width, right, bottom };
							};
							return {
								item: bounds('button[aria-label="Use item"]'),
								stage: bounds(".game-stage"),
								players: bounds(".game-sidebar"),
								jump: mobile ? bounds('button[aria-label="Jump"]') : null,
								width: window.innerWidth,
								height: window.innerHeight,
							};
						}, mobile);
					expect(layout.item.x).toBeGreaterThanOrEqual(layout.stage.right);
					expect(layout.item.right).toBeLessThanOrEqual(layout.width);
					expect(layout.item.y).toBeGreaterThanOrEqual(layout.players.bottom);
					expect(layout.item.bottom).toBeLessThanOrEqual(layout.height);
					if (layout.jump) {
						expect(layout.item.x).toBeCloseTo(layout.jump.x, 0);
						expect(layout.item.width).toBeCloseTo(layout.jump.width, 0);
						expect(layout.jump.y - layout.item.bottom).toBeCloseTo(8, 0);
					} else {
						expect(layout.height - layout.item.bottom).toBeCloseTo(12, 0);
					}
				}).toPass();
			};
			await expectItemLayout();
			await host.screenshot({
				path: info.outputPath(
					mobile ? "items-mobile.png" : "items-desktop.png",
				),
			});
			if (mobile) {
				await host.setViewportSize({ width: 568, height: 320 });
				await expectItemLayout();
				await host.screenshot({
					path: info.outputPath("items-mobile-small.png"),
				});
				await host.setViewportSize({ width: 844, height: 390 });
				await expectItemLayout();
			}
			await host.keyboard.press("Enter");
			await host.getByLabel("Message", { exact: true }).press("KeyE");
			await expect(host.getByLabel("Message", { exact: true })).toHaveValue(
				"e",
			);
			expect(usedItems).toBe(0);
			expect(own.snapshot?.items?.held).toBe(kind);
			await host.keyboard.press("Escape");
			await host.locator("canvas").click();
			if (mobile) await button.tap();
			else await host.keyboard.press("KeyE");
			await expect.poll(() => usedItems).toBe(1);
			if (kind === "BANANA") {
				await expect(button).toHaveAttribute("aria-pressed", "true");
				expect(own.snapshot?.items?.held).toBe("BANANA");
				if (mobile) {
					const jump = await host
						.getByRole("button", { name: "Jump", exact: true })
						.boundingBox();
					if (!jump) throw new Error("Jump button is missing");
					const cdp = await first.newCDPSession(host);
					await cdp.send("Input.dispatchTouchEvent", {
						type: "touchStart",
						touchPoints: [
							{ x: jump.x + jump.width / 2, y: jump.y + jump.height / 2 },
						],
					});
					await host.waitForTimeout(150);
					await cdp.send("Input.dispatchTouchEvent", {
						type: "touchEnd",
						touchPoints: [],
					});
					await cdp.detach();
				} else {
					await host.keyboard.down("Space");
					await host.waitForTimeout(150);
					await host.keyboard.up("Space");
				}
				// Bẫy có thể được đặt và giẫm giữa hai snapshot 20 Hz; kiểm tra tiêu thụ và tác động thật.
				await expect
					.poll(() => own.snapshot?.items?.cooldownMs)
					.toBeGreaterThan(0);
				await expect.poll(() => seenSlip).toBe(true);
				await expect.poll(() => own.snapshot?.items?.bananas.length).toBe(0);
			} else if (kind === "ROCK") {
				await expect.poll(() => seenRock).toBe(true);
				await expect
					.poll(() => other.snapshot?.self.simulation.physics.slipping)
					.toBe(true);
			} else {
				await expect
					.poll(() => own.snapshot?.self.simulation.physics.jumpBoost)
					.toBe(true);
				await expect(button).toContainText("Next jump ×2");
				const jumps = own.snapshot?.self.simulation.physics.jumps ?? 0;
				await host.keyboard.down("Space");
				await expect
					.poll(() => own.snapshot?.self.simulation.physics.jumps)
					.toBe(jumps + 1);
				await host.keyboard.up("Space");
				await expect
					.poll(() => own.snapshot?.self.simulation.physics.jumpBoost)
					.not.toBe(true);
				await expect(button).not.toContainText("Next jump ×2");
			}
			await expect
				.poll(() => own.snapshot?.items?.cooldownMs)
				.toBeGreaterThan(0);
			await expect(button).toBeDisabled();
			await host.screenshot({
				path: info.outputPath(
					mobile ? "items-mobile.png" : "items-desktop.png",
				),
			});
			const bounds = await button.boundingBox();
			expect(
				bounds &&
					viewport &&
					bounds.x >= 0 &&
					bounds.x + bounds.width <= viewport.width,
			).toBeTruthy();
			expect(errors).toEqual([]);
		} finally {
			await leaveOnline(host);
			await leaveOnline(peer);
			await first.close();
			await second.close();
		}
	});
