import { expect, test } from "@playwright/test";
import {
	createRoom,
	leaveOnline,
	newCommunity,
	observeOnline,
	registerOnline,
	startRoom,
} from "./support/online";
import { expectTouchLayout } from "./support/touch-layout";

test.use({
	isMobile: true,
	hasTouch: true,
	viewport: { width: 844, height: 390 },
});

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);
test("Community panels fit screens, scroll and load records only on entry or Refresh", async ({
	page,
}, info) => {
	test.setTimeout(90_000);
	const requests: number[] = [],
		errors: string[] = [];
	let playerCount = 1,
		recordCount = 20;
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.pathname === "/api/leaderboard") {
			expect(url.searchParams.get("limit")).toBe("20");
			requests.push(Date.now());
		}
	});
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		const name = `b${crypto.randomUUID().replaceAll("-", "").slice(0, 5)}`;
		await page.addInitScript(() =>
			localStorage.setItem(
				"jumpking.options",
				JSON.stringify({ sound: false }),
			),
		);
		// Fixture chỉ cho bố cục danh sách dài; đăng nhập và Community dùng backend thật.
		await page.route("**/api/leaderboard?limit=*", (route) =>
			route.fulfill({
				json: {
					entries: Array.from({ length: recordCount }, (_, index) => ({
						id: String(index),
						rank: index + 1,
						username: index < 3 ? "test" : `player_with_a_long_name_${index}`,
						status: index === 0 || index === 2 ? "FINISHED" : "ACTIVE",
						currentProgress: 100,
						maxProgress: 1800,
						elapsedTimeMs: 1000,
						peakReachedTimeMs: 1000,
						finishTimeMs: index === 0 ? 61000 : index === 2 ? 3661000 : null,
					})),
				},
			}),
		);
		await page.routeWebSocket("**/ws/game", (socket) => {
			const server = socket.connectToServer();
			server.onMessage((data) => {
				const message = JSON.parse(data.toString());
				if (message.type === "GAME_SNAPSHOT") {
					// Chỉ thay danh sách hiển thị, không thay physics hoặc người chơi trên server.
					message.payload.players = Array.from(
						{ length: playerCount },
						(_, index) => ({
							playerId: `layout-${index}`,
							nickname: `player${index + 1}`,
							colorSlot: index,
							rank: index + 1,
							currentProgress: 1800 - index,
						}),
					);
					socket.send(JSON.stringify(message));
				} else socket.send(data);
			});
		});
		await page.goto("/");
		await page
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await page.getByLabel("Username", { exact: true }).fill(name);
		await page
			.getByLabel("Password", { exact: true })
			.fill("A secure leaderboard test password");
		await page
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
		await page.getByRole("button", { name: "New Game", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByRole("list", { name: "Community records" }),
		).toBeVisible();
		await expect(page.locator(".records-panel li strong").first()).toHaveText(
			"01:01 s",
		);
		await expect(
			page.getByRole("button", { name: "Refresh", exact: true }),
		).toBeEnabled();
		// StrictMode có thể chạy effect mount hai lần trong dev; không được polling sau đó.
		const initialRequests = requests.length;
		expect(initialRequests).toBeGreaterThan(0);
		await page.screenshot({ path: info.outputPath("community-boards.png") });
		await page.waitForTimeout(10500);
		expect(requests).toHaveLength(initialRequests);
		await page.getByRole("button", { name: "Refresh", exact: true }).click();
		await expect.poll(() => requests.length).toBe(initialRequests + 1);
		const panel = page.locator(".records-panel");
		await expect(panel).toHaveAttribute("open", "");
		await expect(page.locator(".players-panel")).toHaveAttribute("open", "");
		await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
		await expect(page.locator(".chat-panel > summary")).toHaveCount(0);
		const playersPanel = page.locator(".players-panel"),
			playerList = page.getByRole("list", { name: "Current players" }),
			recordsList = page.getByRole("list", { name: "Community records" });
		const panelHeights = () =>
			page
				.locator(".in-game-panel")
				.evaluateAll((panels) =>
					panels.map((element) => element.getBoundingClientRect().height),
				);
		const expectFullHeight = async () => {
			const sidebar = await page.locator(".game-sidebar").boundingBox(),
				last = await page.locator(".in-game-panel").last().boundingBox(),
				jump = await page
					.getByRole("button", { name: "Jump", exact: true })
					.boundingBox();
			if (!sidebar || !last || !jump) throw new Error("Panels are missing");
			expect(last.y + last.height).toBeCloseTo(sidebar.y + sidebar.height, 0);
			expect(jump.y - (sidebar.y + sidebar.height)).toBeCloseTo(8, 0);
		};
		await expect(playerList.getByRole("listitem")).toHaveCount(1);
		await expectFullHeight();
		let heights = await panelHeights();
		expect(heights[1]).toBeGreaterThan((heights[0] ?? 0) * 2);
		expect(
			await playerList
				.getByRole("listitem")
				.first()
				.evaluate((row) => row.getBoundingClientRect().height),
		).toBeLessThanOrEqual(32);
		playerCount = 10;
		await expect(playerList.getByRole("listitem")).toHaveCount(10);
		await expectFullHeight();
		heights = await panelHeights();
		expect(heights[0]).toBeCloseTo(heights[1] ?? 0, 0);
		for (const list of [playerList, recordsList])
			expect(
				await list.evaluate(
					(element) => element.scrollHeight > element.clientHeight,
				),
			).toBe(true);
		await page.screenshot({ path: info.outputPath("panels-both-long.png") });
		await playersPanel.locator("summary").click();
		await expect(playerList).toBeHidden();
		heights = await panelHeights();
		expect(heights[0]).toBeLessThan(35);
		await expectFullHeight();
		await playersPanel.locator("summary").click();
		recordCount = 1;
		await page.getByRole("button", { name: "Refresh", exact: true }).click();
		await expect(recordsList.getByRole("listitem")).toHaveCount(1);
		await expectFullHeight();
		heights = await panelHeights();
		expect(heights[0]).toBeGreaterThan((heights[1] ?? 0) * 2);
		playerCount = 1;
		recordCount = 20;
		await page.getByRole("button", { name: "Refresh", exact: true }).click();
		await expect(playerList.getByRole("listitem")).toHaveCount(1);
		await expect(recordsList.getByRole("listitem")).toHaveCount(20);
		const settleLayout = () =>
			page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
		// F11 từ cửa sổ thường hoặc maximized đều không được phóng to canvas.
		for (const viewport of [
			{ width: 1280, height: 720, expandedWidth: 1280, expandedHeight: 900 },
			{ width: 1280, height: 720, expandedWidth: 1920, expandedHeight: 1080 },
			{ width: 1920, height: 720, expandedWidth: 1920, expandedHeight: 900 },
			{ width: 844, height: 320, expandedWidth: 844, expandedHeight: 390 },
		]) {
			// Mỗi kích thước bắt đầu với giới hạn mới, không kế thừa cửa sổ lớn trước đó.
			await page.setViewportSize({ width: 390, height: 844 });
			await expect(
				page.getByRole("dialog", { name: "Landscape required" }),
			).toBeVisible();
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
			await expect(
				page.getByRole("dialog", { name: "Landscape required" }),
			).toBeHidden();
			await page.getByRole("button", { name: "Resume", exact: true }).click();
			await settleLayout();
			const canvas = page.locator("canvas");
			await expect(canvas).toBeVisible();
			const initial = await canvas.boundingBox();
			if (!initial) throw new Error("Game canvas is missing");
			await page.setViewportSize({
				width: viewport.expandedWidth,
				height: viewport.expandedHeight,
			});
			await settleLayout();
			await expect
				.poll(async () => {
					const expanded = await canvas.boundingBox();
					return (
						expanded && {
							width: Math.round(expanded.width),
							height: Math.round(expanded.height),
						}
					);
				})
				.toEqual({
					width: Math.round(initial.width),
					height: Math.round(initial.height),
				});
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
		}
		for (const viewport of [
			{ width: 2560, height: 1080 },
			{ width: 1920, height: 1080 },
			{ width: 1366, height: 768 },
			{ width: 1280, height: 900 },
			{ width: 1280, height: 1080 },
			{ width: 1024, height: 768 },
			{ width: 844, height: 390 },
			{ width: 932, height: 430 },
			{ width: 667, height: 375 },
			{ width: 568, height: 320 },
		]) {
			await page.setViewportSize({ width: 390, height: 844 });
			await expect(
				page.getByRole("dialog", { name: "Landscape required" }),
			).toBeVisible();
			await page.setViewportSize(viewport);
			await expect(
				page.getByRole("dialog", { name: "Landscape required" }),
			).toBeHidden();
			await settleLayout();
			if (
				await page
					.getByRole("button", { name: "Resume", exact: true })
					.isVisible()
			)
				await page.getByRole("button", { name: "Resume", exact: true }).click();
			const playersPane = page.locator(
				'.game-panel-pane[data-panel="players"]',
			);
			expect(
				await playersPane
					.locator("li")
					.first()
					.evaluate((row) => {
						const name = row.firstElementChild?.getBoundingClientRect(),
							metric = row.lastElementChild?.getBoundingClientRect();
						return (
							!!name &&
							!!metric &&
							name.top < metric.bottom &&
							metric.top < name.bottom
						);
					}),
			).toBe(true);
			await expect(playersPane).toBeVisible();
			await expect(panel).toBeVisible();
			await expect(
				page.getByRole("group", { name: "Game panel selection" }),
			).toHaveCount(0);
			const records = page.getByRole("list", { name: "Community records" });
			await expect(records.getByRole("listitem")).toHaveCount(20);
			expect(
				await records.evaluate((list) => {
					const rows = [...list.children];
					return (
						rows.slice(0, 2).every((row) => {
							const name = row.firstElementChild?.getBoundingClientRect(),
								metric = row.lastElementChild?.getBoundingClientRect();
							return (
								!!name &&
								!!metric &&
								name.top < metric.bottom &&
								metric.top < name.bottom
							);
						}) && rows.every((row) => row.scrollWidth <= row.clientWidth)
					);
				}),
			).toBe(true);
			await records.scrollIntoViewIfNeeded();
			if (viewport.width === 568)
				expect(
					await records.evaluate(
						(element) => element.scrollHeight > element.clientHeight,
					),
				).toBe(true);
			await records.evaluate((element) => {
				element.scrollTop = element.scrollHeight;
			});
			await expect(records.getByRole("listitem").last()).toBeInViewport();
			const scrollTop = await records.evaluate((element) => element.scrollTop);
			const loaded = requests.length;
			await panel.locator("summary").click();
			await expect(records).toBeHidden();
			await panel.locator("summary").click();
			await expect
				.poll(() => records.evaluate((element) => element.scrollTop))
				.toBe(scrollTop);
			expect(requests).toHaveLength(loaded);
			await expect(
				page.getByRole("button", { name: "Refresh", exact: true }),
			).toBeInViewport();
			const canvasLocator = page.locator("canvas");
			await expect
				.poll(async () => {
					const canvas = await canvasLocator.boundingBox(),
						stage = await page.locator(".game-stage").boundingBox();
					return canvas && stage
						? Math.abs(canvas.width - stage.width) +
								Math.abs(canvas.height - stage.height)
						: Infinity;
				})
				.toBeLessThan(1);
			const shell = await page.locator(".play-page").boundingBox(),
				stage = await page.locator(".game-stage").boundingBox(),
				sidebar = await page.locator(".game-sidebar").boundingBox(),
				board = await panel.boundingBox(),
				chat = await page.locator(".game-chat").boundingBox(),
				hud = await page.locator(".game-hud").boundingBox();
			if (!shell || !stage || !sidebar || !board || !chat || !hud)
				throw new Error("Game layout is missing");
			expect(shell.x).toBeCloseTo(0, 0);
			expect(shell.y).toBeCloseTo(0, 0);
			expect(shell.width).toBeCloseTo(viewport.width, 0);
			expect(shell.height).toBeCloseTo(viewport.height, 0);
			expect(stage.width).toBeGreaterThan(0);
			expect(stage.width / stage.height).toBeCloseTo(4 / 3, 2);
			expect(stage.x + stage.width / 2).toBeCloseTo(viewport.width / 2, 0);
			expect(stage.x + stage.width).toBeLessThanOrEqual(sidebar.x);
			expect(sidebar.y).toBeGreaterThanOrEqual(0);
			expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(viewport.width);
			expect(sidebar.y + sidebar.height).toBeLessThanOrEqual(viewport.height);
			expect(chat.x).toBeGreaterThanOrEqual(0);
			expect(chat.x + chat.width).toBeLessThanOrEqual(stage.x);
			expect(chat.y + chat.height).toBeLessThanOrEqual(viewport.height);
			expect(hud.x).toBeGreaterThanOrEqual(0);
			expect(hud.y).toBeGreaterThanOrEqual(0);
			expect(hud.x + hud.width).toBeLessThanOrEqual(stage.x);
			expect(hud.y + hud.height).toBeLessThanOrEqual(chat.y);
			expect(
				await page
					.locator(".game-hud")
					.evaluate((element) => element.scrollWidth <= element.clientWidth),
			).toBe(true);
			const players = await page.locator(".players-panel").boundingBox();
			if (!players) throw new Error("Players panel is missing");
			expect(players.y + players.height).toBeLessThanOrEqual(board.y);
			if (await page.locator(".touch-controls").isVisible()) {
				await expectTouchLayout(page);
				for (const direction of ["Left", "Right", "Up", "Down"]) {
					const control = page.getByRole("button", {
						name: `Move ${direction}`,
						exact: true,
					});
					if (!(await control.isVisible())) continue;
					const bounds = await control.boundingBox();
					if (!bounds) throw new Error("Move button is missing");
					expect(bounds.x + bounds.width).toBeLessThanOrEqual(stage.x);
					expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
					expect(chat.y + chat.height).toBeLessThanOrEqual(bounds.y);
				}
				const jump = await page
					.getByRole("button", { name: "Jump", exact: true })
					.boundingBox();
				if (!jump) throw new Error("Jump button is missing");
				expect(jump.x).toBeGreaterThanOrEqual(stage.x + stage.width);
				expect(jump.y + jump.height).toBeLessThanOrEqual(viewport.height);
				expect(sidebar.y + sidebar.height).toBeLessThanOrEqual(jump.y);
			}
			const canvas = await canvasLocator.boundingBox();
			if (!canvas) throw new Error("Game canvas is missing");
			expect(canvas.width / canvas.height).toBeCloseTo(4 / 3, 2);
			expect(canvas.width).toBeCloseTo(stage.width, 0);
			expect(canvas.height).toBeCloseTo(stage.height, 0);
			expect(canvas.x + canvas.width / 2).toBeCloseTo(viewport.width / 2, 0);
			expect(canvas.y).toBeCloseTo(stage.y, 0);
			if (viewport.width === 844) expect(canvas.width).toBeCloseTo(498, 0);
			if (viewport.width === 568) {
				expect(canvas.width).toBeCloseTo(296, 0);
				expect(canvas.height).toBeCloseTo(222, 0);
			}
			expect(
				await page.evaluate(
					() =>
						document.documentElement.scrollWidth <= innerWidth &&
						document.documentElement.scrollHeight <= innerHeight,
				),
			).toBe(true);
			await page.screenshot({
				path: info.outputPath(
					`community-${viewport.width}-${viewport.height}.png`,
				),
				fullPage: true,
			});
		}
		const cdp = await page.context().newCDPSession(page);
		try {
			for (const insets of [
				{ left: 44, right: 0, bottom: 21 },
				{ left: 0, right: 44, bottom: 21 },
			]) {
				await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
				await page.setViewportSize({ width: 932, height: 430 });
				await settleLayout();
				const boxes = await expectTouchLayout(page);
				expect(Math.abs(430 - boxes.jump.bottom - insets.bottom)).toBeLessThan(
					0.5,
				);
				expect(boxes.directions.x).toBeGreaterThanOrEqual(insets.left);
				expect(boxes.jump.right).toBeLessThanOrEqual(932 - insets.right);
				await page.screenshot({
					path: info.outputPath(
						`safe-area-${insets.left ? "left" : "right"}.png`,
					),
				});
			}
		} finally {
			await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: {} });
			await cdp.detach();
		}
		// Trả về màn nhỏ để danh sách Room dài vẫn cần dùng hết chiều cao cột.
		await page.setViewportSize({ width: 568, height: 320 });
		await settleLayout();
		await page
			.getByRole("button", { name: "Skip tutorial", exact: true })
			.tap();
		await expect(
			page.getByLabel("Tutorial guide", { exact: true }),
		).toHaveCount(0);
		await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await page
			.getByRole("button", { name: "Save & Exit", exact: true })
			.click();
		playerCount = 10;
		await createRoom(page);
		await startRoom(page, page);
		await expect(page.locator(".records-panel")).toHaveCount(0);
		await expect(playerList.getByRole("listitem")).toHaveCount(10);
		await expectFullHeight();
		await expectTouchLayout(page);
		expect(errors).toEqual([]);
	} finally {
		await leaveOnline(page);
	}
});

test("mobile panels preserve drafts and chat stays available while paused", async ({
	page,
}, info) => {
	test.setTimeout(60_000);
	await page.setViewportSize({ width: 844, height: 390 });
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	try {
		const observed = observeOnline(page);
		await registerOnline(page, "panels");
		await newCommunity(page);
		await page.setViewportSize({ width: 390, height: 844 });
		const landscapeGate = page.getByRole("dialog", {
			name: "Landscape required",
		});
		await expect(landscapeGate).toBeVisible();
		const portraitJumps = observed.snapshot?.self.simulation.physics.jumps;
		await page.keyboard.press("Space");
		expect(observed.snapshot?.self.simulation.physics.jumps).toBe(
			portraitJumps,
		);
		await page.setViewportSize({ width: 844, height: 390 });
		await expect(landscapeGate).toBeHidden();
		await expect(
			page.getByRole("button", { name: "Resume", exact: true }),
		).toBeVisible();
		await page.evaluate(async () => {
			const path = "/src/network/GameSocket.ts";
			const { GameSocket } = await import(path);
			const original = GameSocket.prototype.command;
			// Giữ ACK Resume ở client để xoay máy đúng lúc lệnh đang chờ.
			GameSocket.prototype.command = async function (
				type: string,
				payload: Record<string, unknown> = {},
			) {
				const reply = await original.call(this, type, payload);
				if (type === "SET_COMMUNITY_PAUSED" && payload.paused === false) {
					GameSocket.prototype.command = original;
					await new Promise<void>((resolve) =>
						Object.assign(window, { releaseResume: resolve }),
					);
				}
				return reply;
			};
		});
		await page.getByRole("button", { name: "Resume", exact: true }).click();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						typeof (window as unknown as { releaseResume?: () => void })
							.releaseResume === "function",
				),
			)
			.toBe(true);
		await expect.poll(() => observed.snapshot?.self.paused).toBe(false);
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(landscapeGate).toBeVisible();
		await page.evaluate(() =>
			(window as unknown as { releaseResume: () => void }).releaseResume(),
		);
		await expect.poll(() => observed.snapshot?.self.paused).toBe(true);
		await page.setViewportSize({ width: 844, height: 390 });
		await expect(landscapeGate).toBeHidden();
		await page.getByRole("button", { name: "Resume", exact: true }).click();
		const message = page.getByLabel("Message", { exact: true });
		await expect(message).toBeVisible();
		await message.fill("Visible chat history");
		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(page.getByRole("log")).toContainText("Visible chat history");
		await message.fill("Unsent draft");
		await page.locator("canvas").focus();
		await page.keyboard.press("Enter");
		await expect(message).toBeFocused();
		await expect(message).toHaveValue("Unsent draft");
		await page.keyboard.press("Escape");
		await expect(message).toBeVisible();
		await expect(message).toHaveValue("Unsent draft");
		await page.mouse.move(0, 0);
		for (const viewport of [
			{ width: 844, height: 390 },
			{ width: 568, height: 320 },
		]) {
			await page.setViewportSize(viewport);
			if (viewport.width <= 680) {
				await expect(page.locator(".chat-history-box")).toHaveAttribute(
					"aria-hidden",
					"true",
					{ timeout: 20_000 },
				);
				await expect(
					page.getByRole("button", { name: "Show chat history", exact: true }),
				).toHaveCount(0);
				await message.tap();
				await expect(page.locator(".chat-history-box")).toHaveAttribute(
					"aria-hidden",
					"false",
				);
				await expect(message).toBeFocused();
			}
			const records = page.locator(".records-panel");
			await records.locator("summary").tap();
			await expect(records.getByRole("list")).toBeHidden();
			await expect(page.locator(".players-panel summary")).toBeVisible();
			await records.locator("summary").tap();
			await expect(records.getByRole("list")).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Refresh", exact: true }),
			).toBeVisible();
			await expect(message).toBeVisible();
			await expect(message).toHaveValue("Unsent draft");
			await page.screenshot({
				path: info.outputPath(`panels-${viewport.width}.png`),
			});
		}
		const players = page.locator(".players-panel"),
			summary = players.locator("summary"),
			jumps = observed.snapshot?.self.simulation.physics.jumps;
		await summary.focus();
		await page.keyboard.press("Space");
		await expect(players.getByRole("list")).toBeHidden();
		await page.keyboard.press("Enter");
		await expect(players.getByRole("list")).toBeVisible();
		expect(observed.snapshot?.self.simulation.physics.jumps).toBe(jumps);
		expect(observed.snapshot?.self.simulation.physics.charge).toBe(0);
		await page.keyboard.press("Escape");
		const menu = page.getByRole("region", { name: "Game menu", exact: true });
		await expect(menu).toBeVisible();
		await expect(message).toBeVisible();
		await message.fill("Draft while paused");
		await expect(message).toHaveValue("Draft while paused");
		const menuBox = await menu.locator(".menu-panel").boundingBox(),
			chatBox = await page.locator(".game-chat").boundingBox();
		if (!menuBox || !chatBox) throw new Error("Pause panels are missing");
		expect(menuBox.x).toBeGreaterThanOrEqual(chatBox.x + chatBox.width + 8);
		await menu.locator(".controls-help").scrollIntoViewIfNeeded();
		expect(
			await menu.locator(".controls-help").evaluate((help) =>
				[...help.querySelectorAll("dt")].every((label) => {
					const term = label.getBoundingClientRect(),
						keys = label.nextElementSibling?.getBoundingClientRect();
					return (
						keys &&
						term.right <= keys.left &&
						term.top < keys.bottom &&
						keys.top < term.bottom &&
						keys.height <=
							Math.max(
								...Array.from(
									label.nextElementSibling?.children || [],
									(key) => key.getBoundingClientRect().height,
								),
							) +
								1
					);
				}),
			),
		).toBe(true);
		await page.screenshot({ path: info.outputPath("pause-chat-mobile.png") });
		await menu.scrollIntoViewIfNeeded();
		expect(
			await menu.evaluate((element) => {
				const box = element.getBoundingClientRect();
				return element.contains(
					document.elementFromPoint(
						box.x + box.width / 2,
						box.y + box.height / 2,
					),
				);
			}),
		).toBe(true);
		await expect(page.getByText("Saved", { exact: true })).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Open Chat", exact: true }),
		).toHaveCount(0);
		await page.getByRole("button", { name: "Resume", exact: true }).click();
	} finally {
		await leaveOnline(page);
	}
});

test.describe("Desktop panels", () => {
	test.use({
		isMobile: false,
		hasTouch: false,
		viewport: { width: 1280, height: 900 },
	});

	test("long lists stay capped and leave space below the panels", async ({
		page,
	}, info) => {
		await page.route("**/api/leaderboard?limit=*", (route) =>
			route.fulfill({
				json: {
					entries: Array.from({ length: 20 }, (_, index) => ({
						id: String(index),
						rank: index + 1,
						username: `player_with_a_long_name_${index}`,
						status: "ACTIVE",
						currentProgress: 100,
						maxProgress: 1800,
						elapsedTimeMs: 1000,
						peakReachedTimeMs: 1000,
						finishTimeMs: null,
					})),
				},
			}),
		);
		try {
			await registerOnline(page, "desktop_panels");
			await newCommunity(page);
			const list = page.getByRole("list", { name: "Community records" });
			await expect(list.getByRole("listitem")).toHaveCount(20);
			for (const viewport of [
				{ width: 1280, height: 900 },
				{ width: 844, height: 390 },
			]) {
				await page.setViewportSize(viewport);
				await expect
					.poll(async () => {
						const bounds = await page.locator(".game-sidebar").boundingBox();
						return Math.round(bounds?.height ?? 0);
					})
					.toBe(Math.round(Math.min(640, viewport.height * 0.75)));
				await expect(page.locator(".touch-controls")).toBeHidden();
				await expect(page.locator(".players-panel summary")).toBeVisible();
				await expect(page.locator(".records-panel summary")).toBeVisible();
				await list.evaluate((element) => {
					element.scrollTop = element.scrollHeight;
				});
				await expect(list.getByRole("listitem").last()).toBeInViewport();
				await expect(
					page.getByRole("button", { name: "Refresh", exact: true }),
				).toBeInViewport();
				await page.screenshot({
					path: info.outputPath(`desktop-panels-${viewport.width}.png`),
				});
			}
		} finally {
			await leaveOnline(page);
		}
	});
});
