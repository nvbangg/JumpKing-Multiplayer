import { expect, type Page } from "@playwright/test";

/** Dọn đúng membership của browser, kể cả khi assertion thất bại; không xóa dữ liệu server. */
export async function leaveOnline(page: Page): Promise<void> {
	if (page.isClosed() || !page.url().startsWith("http")) return;
	await page.evaluate(async () => {
		const socketPath = "/src/network/GameSocket.ts",
			reconnectPath = "/src/network/reconnect.ts";
		const { loadReconnect } = await import(reconnectPath);
		const me = await (await fetch("/api/auth/me")).json();
		if (!me.account) return;
		const profile = `${location.origin}:account:${me.account.id}`;
		if (!(await loadReconnect(profile))) return;
		const { GameSocket } = await import(socketPath),
			socket = new GameSocket(
				() => {},
				() => {},
			);
		try {
			await socket.restore(profile);
			if (socket.selfId) await socket.command("LEAVE_ROOM");
		} finally {
			socket.close();
		}
	});
}

/** Ghi nhận snapshot thật qua WebSocket, không mở kết nối thay thế hoặc sửa state game. */
export function observeOnline(page: Page) {
	const observed: {
		snapshot?: import("../../src/game/netcode/OnlineRuntime").OnlineSnapshot;
	} = {};
	page.on("websocket", (socket) => {
		if (new URL(socket.url()).pathname !== "/ws/game") return;
		socket.on("framereceived", (frame) => {
			const message = JSON.parse(frame.payload.toString());
			if (message.type === "GAME_SNAPSHOT") observed.snapshot = message.payload;
		});
	});
	return observed;
}

export async function registerOnline(page: Page, prefix: string) {
	const username = `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
	await page.goto("/");
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await page.getByLabel("Username", { exact: true }).fill(username);
	await page
		.getByLabel("Password", { exact: true })
		.fill("A secure browser test password");
	await page
		.getByRole("button", { name: "Sign In / Log In", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: username, exact: true }),
	).toBeVisible();
	return username;
}

export async function createRoom(page: Page) {
	await page.getByRole("button", { name: "Create Room", exact: true }).click();
	return (await page.locator(".room-code code").innerText()).trim();
}
export async function joinRoom(page: Page, id: string) {
	await page.getByLabel("Room ID", { exact: true }).fill(id);
	await page.getByRole("button", { name: "Join", exact: true }).click();
	await expect(page.locator(".room-code code")).toHaveText(id);
}
export async function startRoom(host: Page, peer: Page) {
	await host.bringToFront();
	await host.getByRole("button", { name: "Start", exact: true }).click();
	for (const page of [host, peer])
		await expect(
			page.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible({ timeout: 30000 });
	await expect(host.getByLabel("Play time", { exact: true })).not.toHaveText(
		"00:00 s",
		{ timeout: 10000 },
	);
	await host.bringToFront();
	if (
		await host.getByRole("button", { name: "Resume", exact: true }).isVisible()
	)
		await host.getByRole("button", { name: "Resume", exact: true }).click();
	await host.locator("canvas").click();
	await expect(host.locator("canvas")).toBeFocused();
}

export async function newCommunity(page: Page) {
	await page.getByRole("button", { name: "New Game", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu (Esc)", exact: true }),
	).toBeVisible({ timeout: 30000 });
	await page.locator("canvas").click();
}

export async function landOnMapMarker(
	page: Page,
	player: () => {
		x: number;
		y: number;
		grounded: boolean;
		freeFlight: boolean;
	},
	marker: { x: number; y: number; width: number },
	bodyWidth: number,
	bodyHeight: number,
) {
	await page.keyboard.down("ArrowUp");
	await expect
		.poll(() => player().y + bodyHeight <= marker.y - 16, {
			timeout: 15000,
			intervals: [16],
		})
		.toBe(true);
	await page.keyboard.up("ArrowUp");

	const targetX = marker.x + (marker.width - bodyWidth) / 2,
		startX = player().x;
	if (Math.abs(startX - targetX) > 2) {
		const key = startX < targetX ? "ArrowRight" : "ArrowLeft";
		await page.keyboard.down(key);
		await expect
			.poll(
				() =>
					startX < targetX ? player().x >= targetX : player().x <= targetX,
				{ timeout: 15000, intervals: [16] },
			)
			.toBe(true);
		await page.keyboard.up(key);
	}

	await page.keyboard.press("Space");
	await page.waitForTimeout(80);
	await page.keyboard.press("Space");
	await expect.poll(() => player().freeFlight).toBe(false);
	await expect
		.poll(() => {
			const state = player();
			return state.grounded && state.y + bodyHeight <= marker.y;
		})
		.toBe(true);
}
