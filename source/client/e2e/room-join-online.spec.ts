import { expect, type Page, test } from "@playwright/test";
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
	"Requires the isolated backend/MySQL integration harness",
);

// Giữ tham chiếu socket thật để mô phỏng ngắt đường truyền, không giả lập phản hồi server.
async function trackConnections(page: Page) {
	await page.addInitScript(() => {
		const sockets: WebSocket[] = [];
		Object.defineProperty(window, "roomTestSockets", { value: sockets });
		window.WebSocket = new Proxy(window.WebSocket, {
			construct(target, args) {
				const socket = Reflect.construct(target, args) as WebSocket;
				if (new URL(socket.url).pathname === "/ws/game") sockets.push(socket);
				return socket;
			},
		});
	});
}

async function disconnect(page: Page) {
	await page.context().setOffline(true);
	await page.evaluate(() => {
		const tracked = window as unknown as { roomTestSockets: WebSocket[] };
		for (const socket of tracked.roomTestSockets) socket.close();
	});
}

async function connectionCount(page: Page) {
	return page.evaluate(() => {
		const tracked = window as unknown as { roomTestSockets: WebSocket[] };
		return tracked.roomTestSockets.filter(
			(socket) => socket.readyState < WebSocket.CLOSING,
		).length;
	});
}

async function endMatch(page: Page) {
	await page.bringToFront();
	if (
		await page.getByRole("button", { name: "Resume", exact: true }).isVisible()
	)
		await page.getByRole("button", { name: "Resume", exact: true }).click();
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	await page.getByRole("button", { name: "End Match", exact: true }).click();
	await expect(page.getByText("Results saved", { exact: true })).toBeVisible();
}

test("solo host is confirmed immediately, can cancel, sees 3-2-1 and returns to Lobby through Play Again", async ({
	page,
}) => {
	test.setTimeout(60000);
	await trackConnections(page);
	const observed = observeOnline(page);
	try {
		await registerOnline(page, "join_solo");
		const roomId = await createRoom(page);
		const roster = page.getByRole("region", { name: "Room players" });
		await expect(roster).toContainText("Confirmed");
		await expect(
			page.getByRole("button", { name: "Start", exact: true }),
		).toBeEnabled();
		await expect(
			page.getByLabel("Mode", { exact: true }).locator("option"),
		).toHaveText([
			"RACE – Default",
			"EASY – Respawn at Last Position",
			"HARDCORE – Restart on Death",
			"NO WALK – Jump Only",
		]);
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Start", exact: true }),
		).toBeDisabled();
		await expect(roster).not.toContainText("Confirmed");
		await page.getByRole("button", { name: "Confirm", exact: true }).click();
		await page.getByRole("button", { name: "Start", exact: true }).click();
		for (const count of ["3", "2", "1"])
			await expect(
				page.getByRole("status").filter({ hasText: new RegExp(`^${count}$`) }),
			).toBeVisible({ timeout: 30000 });
		await expect
			.poll(() => observed.snapshot?.elapsedTimeMs ?? 0)
			.toBeGreaterThan(0);
		const playId = observed.snapshot?.playId;
		await endMatch(page);
		await page.getByRole("button", { name: "Play Again", exact: true }).click();
		await expect(page.locator(".room-code code")).toHaveText(roomId);
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(
			page.getByRole("heading", { name: "Lobby", exact: true }),
		).toBeVisible();
		await disconnect(page);
		await expect(
			page.getByRole("button", { name: "Reconnect", exact: true }),
		).toBeVisible();
		await page.context().setOffline(false);
		await expect(
			page.getByRole("button", { name: "Reconnect", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Confirm", exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Confirm", exact: true }).click();
		await startRoom(page, page);
		await expect.poll(() => observed.snapshot?.playId).not.toBe(playId);
		await endMatch(page);
	} finally {
		await page.context().setOffline(false);
		await leaveOnline(page);
	}
});

test("Lobby automatically reconnects once online, preserves cancellation and Leave stops recovery", async ({
	browser,
}) => {
	test.setTimeout(60000);
	const hostContext = await browser.newContext(),
		peerContext = await browser.newContext();
	const host = await hostContext.newPage(),
		peer = await peerContext.newPage();
	await trackConnections(peer);
	try {
		await registerOnline(host, "auto_host");
		const peerName = await registerOnline(peer, "auto_peer");
		const roomId = await createRoom(host);
		await joinRoom(peer, roomId);
		await peer.getByRole("button", { name: "Cancel", exact: true }).click();
		const row = host
			.getByRole("region", { name: "Room players" })
			.getByRole("listitem")
			.filter({ hasText: peerName });
		await expect(row).not.toContainText("Confirmed");
		await disconnect(peer);
		await expect(
			peer.getByRole("button", { name: "Reconnect", exact: true }),
		).toBeVisible();
		await expect(row).toContainText("Offline");
		await peerContext.setOffline(false);
		await expect(
			peer.getByRole("button", { name: "Reconnect", exact: true }),
		).toHaveCount(0);
		await expect(row).not.toContainText("Offline");
		await expect(row).not.toContainText("Confirmed");
		await expect(
			peer.getByRole("button", { name: "Confirm", exact: true }),
		).toBeVisible();
		await expect.poll(() => connectionCount(peer)).toBe(1);
		await expect(
			host.getByRole("region", { name: "Room players" }).getByRole("listitem"),
		).toHaveCount(2);
		await peer.getByRole("button", { name: "Leave", exact: true }).click();
		await expect(
			peer.getByRole("button", { name: "Create Room", exact: true }),
		).toBeVisible();
		await peerContext.setOffline(true);
		await peerContext.setOffline(false);
		await peer.waitForTimeout(1500);
		await expect.poll(() => connectionCount(peer)).toBe(0);
		await expect(
			host.getByRole("region", { name: "Room players" }).getByRole("listitem"),
		).toHaveCount(1);
	} finally {
		await peerContext.setOffline(false);
		await leaveOnline(host);
		await leaveOnline(peer);
		await hostContext.close();
		await peerContext.close();
	}
});

test("an interrupted Leave keeps recovery manual instead of automatically rejoining", async ({
	page,
}) => {
	await trackConnections(page);
	try {
		await registerOnline(page, "leave_lost");
		await createRoom(page);
		await page.evaluate(() => {
			const tracked = window as unknown as { roomTestSockets: WebSocket[] };
			const socket = tracked.roomTestSockets.at(-1);
			if (!socket) throw new Error("Room socket is missing");
			const send = socket.send.bind(socket);
			// Mất đường truyền ngay khi gửi Leave: server không nhận lệnh và không có ACK giả.
			socket.send = (data) => {
				if (typeof data === "string" && JSON.parse(data).type === "LEAVE_ROOM")
					socket.close();
				else send(data);
			};
		});
		await page.getByRole("button", { name: "Leave", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Reconnect", exact: true }),
		).toBeVisible();
		await page.waitForTimeout(2200);
		expect(await connectionCount(page)).toBe(0);
		await expect(page.locator(".room-code code")).toBeVisible();
		await page.getByRole("button", { name: "Reconnect", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Reconnect", exact: true }),
		).toHaveCount(0);
		await page.getByRole("button", { name: "Leave", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Create Room", exact: true }),
		).toBeVisible();
	} finally {
		await leaveOnline(page);
	}
});

test("host kicks connected and offline players and neither rejoins through recovery", async ({
	browser,
}) => {
	test.setTimeout(60000);
	const hostContext = await browser.newContext(),
		peerContext = await browser.newContext();
	const host = await hostContext.newPage(),
		peer = await peerContext.newPage();
	await trackConnections(peer);
	try {
		await registerOnline(host, "kick_host");
		const peerName = await registerOnline(peer, "kick_peer");
		const roomId = await createRoom(host);
		await joinRoom(peer, roomId);
		await expect(peer.getByRole("button", { name: /^Kick/ })).toHaveCount(0);
		await expect(host.getByRole("button", { name: /^Kick/ })).toHaveCount(1);
		await host
			.getByRole("button", { name: `Kick ${peerName}`, exact: true })
			.click();
		await expect(peer.getByText(/kicked/i)).toBeVisible();
		await expect(
			peer.getByRole("button", { name: "Create Room", exact: true }),
		).toBeVisible();
		await peerContext.setOffline(true);
		await peerContext.setOffline(false);
		await peer.waitForTimeout(1500);
		await expect.poll(() => connectionCount(peer)).toBe(0);
		// Người bị kick chỉ được vào lại bằng thao tác Join mới, không dùng token cũ.
		await joinRoom(peer, roomId);
		await disconnect(peer);
		await expect(
			host.getByRole("region", { name: "Room players" }),
		).toContainText("Offline");
		await host
			.getByRole("button", { name: `Kick ${peerName}`, exact: true })
			.click();
		await peerContext.setOffline(false);
		await expect(
			peer.getByRole("button", { name: "Create Room", exact: true }),
		).toBeVisible();
		await expect(
			host.getByRole("region", { name: "Room players" }).getByRole("listitem"),
		).toHaveCount(1);
		await peer.waitForTimeout(1500);
		await expect(peer.locator(".room-code")).toHaveCount(0);
	} finally {
		await peerContext.setOffline(false);
		await leaveOnline(host);
		await leaveOnline(peer);
		await hostContext.close();
		await peerContext.close();
	}
});

test("the next Lobby only lists players who chose Play Again, including those who cancel confirmation", async ({
	browser,
}) => {
	test.setTimeout(60000);
	const hostContext = await browser.newContext(),
		peerContext = await browser.newContext();
	const host = await hostContext.newPage(),
		peer = await peerContext.newPage();
	try {
		await registerOnline(host, "again_host");
		const peerName = await registerOnline(peer, "again_peer");
		await joinRoom(peer, await createRoom(host));
		const roster = host.getByRole("region", { name: "Room players" });
		await expect(roster.getByRole("listitem")).toHaveCount(2);
		await startRoom(host, peer);
		await endMatch(host);
		await expect(
			peer.getByRole("heading", { name: "Results", exact: true }),
		).toBeVisible();
		await host.getByRole("button", { name: "Play Again", exact: true }).click();
		await expect(roster.getByRole("listitem")).toHaveCount(1);
		await expect(roster).not.toContainText(peerName);
		await expect(
			peer.getByRole("button", { name: "Play Again", exact: true }),
		).toBeVisible();
		await peer.getByRole("button", { name: "Play Again", exact: true }).click();
		await expect(roster.getByRole("listitem")).toHaveCount(2);
		await peer.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(roster.getByRole("listitem")).toHaveCount(2);
		await expect(
			roster.getByRole("listitem").filter({ hasText: peerName }),
		).not.toContainText("Confirmed");
		await expect(
			peer.getByRole("heading", { name: "Lobby", exact: true }),
		).toBeVisible();
	} finally {
		await leaveOnline(host);
		await leaveOnline(peer);
		await hostContext.close();
		await peerContext.close();
	}
});

test("game offers manual Reconnect and restores the same match without duplicate players", async ({
	page,
}) => {
	test.setTimeout(60000);
	await trackConnections(page);
	const observed = observeOnline(page);
	const inputs = new Set<string>(),
		duplicates: string[] = [];
	page.on("websocket", (socket) => {
		if (new URL(socket.url()).pathname !== "/ws/game") return;
		socket.on("framesent", (frame) => {
			const message = JSON.parse(frame.payload.toString());
			if (message.type !== "PLAYER_INPUT") return;
			const { playId, generation, seq } = message.payload;
			const key = `${playId}:${generation}:${seq}`;
			if (inputs.has(key)) duplicates.push(key);
			inputs.add(key);
		});
	});
	try {
		await registerOnline(page, "manual_room");
		await createRoom(page);
		await startRoom(page, page);
		const playId = observed.snapshot?.playId,
			generation = observed.snapshot?.generation ?? 0;
		await disconnect(page);
		await expect(
			page.getByRole("button", { name: "Reconnect", exact: true }),
		).toBeVisible();
		await page.context().setOffline(false);
		await page.getByRole("button", { name: "Reconnect", exact: true }).click();
		await expect
			.poll(() => observed.snapshot?.generation ?? 0)
			.toBeGreaterThan(generation);
		expect(observed.snapshot?.playId).toBe(playId);
		await expect.poll(() => connectionCount(page)).toBe(1);
		await expect(
			page.getByRole("button", { name: "Reconnect", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("list", { name: "Current players" }).getByRole("listitem"),
		).toHaveCount(1);
		await page.getByRole("button", { name: "Resume", exact: true }).click();
		await page.locator("canvas").click();
		await page.keyboard.down("ArrowRight");
		const before = inputs.size;
		await expect.poll(() => inputs.size).toBeGreaterThan(before + 3);
		await page.keyboard.up("ArrowRight");
		expect(duplicates).toEqual([]);
		await endMatch(page);
	} finally {
		await page.context().setOffline(false);
		await leaveOnline(page);
	}
});

test("copy icon becomes a check for two seconds after the latest successful copy", async ({
	page,
}) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	try {
		await registerOnline(page, "copy_room");
		const roomId = await createRoom(page);
		const copy = page.getByRole("button", {
				name: "Copy room ID",
				exact: true,
			}),
			notice = page.locator(".room-code").getByRole("status");
		await copy.click();
		await expect(copy.locator(".lucide-check")).toBeVisible();
		await expect(notice).toHaveClass("visually-hidden");
		await expect(notice).toHaveText("Copied");
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
			roomId,
		);
		await page.waitForTimeout(1100);
		await copy.click();
		await page.waitForTimeout(1100);
		await expect(notice).toHaveText("Copied");
		await expect(copy.locator(".lucide-check")).toBeVisible();
		await expect(copy.locator(".lucide-copy")).toBeVisible({ timeout: 1500 });
	} finally {
		await leaveOnline(page);
	}
});

test("chat cooldown stays inside Chat and the server still rejects the second message", async ({
	page,
}) => {
	const codes: string[] = [];
	page.on("websocket", (socket) =>
		socket.on("framereceived", (frame) => {
			const message = JSON.parse(frame.payload.toString());
			if (message.type === "ERROR") codes.push(message.payload.code);
		}),
	);
	try {
		await registerOnline(page, "spam_room");
		await createRoom(page);
		const chat = page.getByRole("region", { name: "Room chat", exact: true }),
			input = chat.getByRole("textbox", { name: "Message", exact: true });
		await input.fill("First accepted");
		await chat.getByRole("button", { name: "Send", exact: true }).click();
		await input.fill("Second rejected");
		await chat.getByRole("button", { name: "Send", exact: true }).click();
		await expect(chat.getByRole("alert")).toContainText(
			"Wait before sending another message",
		);
		await expect(page.getByRole("alert")).toHaveCount(1);
		expect(codes).toContain("RATE_LIMITED");
		await expect(chat.getByRole("log")).toContainText("First accepted");
		await expect(chat.getByRole("log")).not.toContainText("Second rejected");
		await page.waitForTimeout(1100);
		await input.fill("Third accepted");
		await chat.getByRole("button", { name: "Send", exact: true }).click();
		await expect(chat.getByRole("log")).toContainText("Third accepted");
		await expect(page.getByRole("alert")).toHaveCount(0);
	} finally {
		await leaveOnline(page);
	}
});
