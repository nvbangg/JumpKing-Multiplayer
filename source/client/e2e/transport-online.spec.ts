import { expect, test } from "@playwright/test";
import type { OnlineSnapshot } from "../src/game/netcode/OnlineRuntime";
import {
	createRoom,
	leaveOnline,
	newCommunity,
	registerOnline,
} from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);

test("two independent browser identities use real WS and logout revokes only the account socket", async ({
	browser,
}) => {
	const first = await browser.newContext(),
		second = await browser.newContext();
	try {
		const a = await first.newPage(),
			b = await second.newPage();
		await a.goto("/");
		await b.goto("/");
		const setup = async (page: typeof a) =>
			page.evaluate(async () => {
				const csrf = await (await fetch("/api/auth/csrf")).json();
				const name = `ws_${crypto.randomUUID().replaceAll("-", "").slice(0, 15)}`;
				const response = await fetch("/api/auth/login", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						[csrf.headerName]: csrf.token,
					},
					body: JSON.stringify({
						username: name,
						password: "A secure WS browser password",
					}),
				});
				if (!response.ok)
					throw new Error(`Identity creation failed: ${response.status}`);
				const messages: Record<string, unknown>[] = [];
				let closed = false;
				const socket = new WebSocket(
					`${location.origin.replace("http", "ws")}/ws/game`,
				);
				socket.onmessage = (event) => messages.push(JSON.parse(event.data));
				socket.onclose = () => {
					closed = true;
				};
				await new Promise<void>((resolve, reject) => {
					socket.onopen = () => resolve();
					socket.onerror = () => reject(new Error("WS handshake failed"));
				});
				Object.assign(window, {
					wsTest: {
						socket,
						messages,
						get closed() {
							return closed;
						},
					},
				});
				socket.send(
					JSON.stringify({
						v: 1,
						type: "HEARTBEAT",
						requestId: "ping",
						payload: { nonce: name },
					}),
				);
				socket.send(
					JSON.stringify({
						v: 1,
						type: "GET_ROOM_STATE",
						requestId: "state",
						payload: {},
					}),
				);
				return name;
			});
		const nameA = await setup(a),
			nameB = await setup(b);
		const messages = async (page: typeof a) =>
			page.evaluate(
				() =>
					(window as unknown as { wsTest: { messages: unknown[] } }).wsTest
						.messages,
			);
		await expect.poll(() => messages(a)).toHaveLength(2);
		await expect.poll(() => messages(b)).toHaveLength(2);
		expect((await messages(a))[0]).toMatchObject({
			type: "PONG",
			requestId: "ping",
			payload: { nonce: nameA },
		});
		expect((await messages(b))[0]).toMatchObject({
			type: "PONG",
			requestId: "ping",
			payload: { nonce: nameB },
		});
		expect((await messages(a))[1]).toMatchObject({
			type: "ROOM_STATE",
			payload: { roomId: null, members: [] },
		});
		await a.evaluate(() => {
			const state = (window as unknown as { wsTest: { socket: WebSocket } })
				.wsTest;
			state.socket.send(
				JSON.stringify({
					v: 1,
					type: "HEARTBEAT",
					requestId: "ping",
					payload: { nonce: "different" },
				}),
			);
			state.socket.send(
				JSON.stringify({
					v: 1,
					type: "HEARTBEAT",
					requestId: "invalid",
					payload: { nonce: 123 },
				}),
			);
			state.socket.send(
				JSON.stringify({
					v: 1,
					type: "HEARTBEAT",
					requestId: "ping",
					payload: { nonce: "__replace__" },
				}),
			);
		});
		await expect.poll(() => messages(a)).toHaveLength(5);
		expect((await messages(a))[2]).toMatchObject({
			type: "ERROR",
			payload: { code: "CONFLICT" },
		});
		expect((await messages(a))[3]).toMatchObject({
			type: "ERROR",
			payload: { code: "INVALID_MESSAGE" },
		});
		const extra = await b.evaluate(async () => {
			const connect = () =>
				new Promise<WebSocket>((resolve, reject) => {
					const socket = new WebSocket(
						`${location.origin.replace("http", "ws")}/ws/game`,
					);
					socket.onopen = () => resolve(socket);
					socket.onerror = () => reject(new Error("rejected"));
				});
			const second = await connect();
			let rejected = false;
			try {
				await connect();
			} catch {
				rejected = true;
			}
			second.close();
			return rejected;
		});
		expect(extra).toBe(true);
		await a.evaluate(async () => {
			const csrf = await (await fetch("/api/auth/csrf")).json();
			const response = await fetch("/api/auth/logout", {
				method: "POST",
				headers: { [csrf.headerName]: csrf.token },
			});
			if (!response.ok) throw new Error("Logout failed");
		});
		await expect
			.poll(() =>
				a.evaluate(
					() =>
						(window as unknown as { wsTest: { closed: boolean } }).wsTest
							.closed,
				),
			)
			.toBe(true);
		expect(
			await b.evaluate(
				() =>
					(window as unknown as { wsTest: { closed: boolean } }).wsTest.closed,
			),
		).toBe(false);
	} finally {
		await first.close();
		await second.close();
	}
});

test("monotonic input cadence preserves jump timing across render drift and snapshot stalls in both modes", async ({
	page,
}) => {
	test.setTimeout(90_000);
	let latest: OnlineSnapshot | undefined,
		sent = 0,
		ack = 0,
		peak = 0,
		hold = false;
	const current = () => latest;
	const inputFrames: { jump: boolean }[] = [];
	const held: (() => void)[] = [],
		errors: string[] = [];
	const timers = new Set<ReturnType<typeof setTimeout>>();
	page.on("pageerror", (error) => errors.push(error.message));
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	await page.routeWebSocket("**/ws/game", (socket) => {
		const server = socket.connectToServer();
		let closed = false;
		server.onClose((code, reason) => {
			closed = true;
			socket.close({ code, reason });
		});
		socket.onMessage((message) => {
			const packet = JSON.parse(message.toString());
			if (packet.type === "PLAYER_INPUT") {
				inputFrames.push({ jump: packet.payload.jump === true });
				sent = packet.payload.seq;
				peak = Math.max(peak, sent - ack);
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const deliver = () => {
				if (closed) return;
				const packet = JSON.parse(message.toString());
				if (packet.type === "GAME_SNAPSHOT") {
					latest = packet.payload;
					ack = packet.payload.self.lastProcessedInputSeq;
				}
				socket.send(message);
			};
			// Socket thật vẫn nối backend; chỉ trì hoãn chiều nhận để mô phỏng RTT khoảng 260 ms.
			const timer = setTimeout(() => {
				timers.delete(timer);
				if (hold) held.push(deliver);
				else deliver();
			}, 260);
			timers.add(timer);
		});
	});
	try {
		await registerOnline(page, "ack_pacing");
		await expect(page).toHaveTitle(/JumpKing/);
		await page.evaluate(async () => {
			const path = "/src/game/netcode/OnlineRuntime.ts";
			const { OnlineRuntime } = await import(path);
			const advance = OnlineRuntime.prototype.advance;
			// Delta render bị lệch vẫn không được làm input nhanh hơn đồng hồ thực.
			OnlineRuntime.prototype.advance = function (delta: number) {
				advance.call(this, delta * 1.2);
			};
		});
		for (const kind of ["COMMUNITY", "ROOM"]) {
			latest = undefined;
			sent = ack = peak = 0;
			inputFrames.length = 0;
			if (kind === "COMMUNITY") await newCommunity(page);
			else {
				await createRoom(page);
				await page.getByRole("button", { name: "Start", exact: true }).click();
				await expect(
					page.getByRole("button", { name: "Menu (Esc)", exact: true }),
				).toBeVisible();
				await expect.poll(() => current()?.self.paused).toBe(false);
				if (
					await page
						.getByRole("button", { name: "Resume", exact: true })
						.isVisible()
				)
					await page
						.getByRole("button", { name: "Resume", exact: true })
						.click();
				await page.locator("canvas").click();
			}
			await expect
				.poll(() => current()?.self.simulation.physics.ticks ?? 0)
				.toBeGreaterThan(120);
			const before = current()?.self.simulation.physics.ticks ?? 0;
			const inputsBeforeStall = inputFrames.length;
			const jumpsBeforeStall = current()?.self.simulation.physics.jumps ?? 0;
			hold = true;
			await page.waitForTimeout(100);
			await page.keyboard.down("Space");
			await page.waitForTimeout(200);
			await page.keyboard.up("Space");
			await page.waitForTimeout(150);
			const stalledInputs = inputFrames.slice(inputsBeforeStall);
			// Không chỉ còn cạnh nhấn/thả: 200 ms phải giữ khoảng 12 frame charge.
			expect(stalledInputs.length).toBeGreaterThanOrEqual(24);
			const charged = stalledInputs.filter((input) => input.jump).length;
			expect(charged).toBeGreaterThanOrEqual(10);
			expect(charged).toBeLessThanOrEqual(15);
			hold = false;
			for (const deliver of held.splice(0)) deliver();
			await expect
				.poll(() => current()?.self.simulation.physics.jumps ?? 0)
				.toBeGreaterThan(jumpsBeforeStall);
			await expect
				.poll(() => current()?.self.simulation.physics.ticks ?? 0, {
					timeout: 15_000,
				})
				.toBeGreaterThan(before + 600);
			expect(peak).toBeLessThan(90);
			await expect(
				page.getByRole("button", { name: "Reconnect", exact: true }),
			).toHaveCount(0);
			await expect(
				page.getByRole("button", { name: "Resume", exact: true }),
			).toHaveCount(0);
			const jumps = current()?.self.simulation.physics.jumps ?? 0;
			await page.keyboard.down("Space");
			await page.waitForTimeout(200);
			await page.keyboard.up("Space");
			await expect
				.poll(() => current()?.self.simulation.physics.jumps ?? 0)
				.toBeGreaterThan(jumps);
			if (kind === "ROOM" && process.env.E2E_ACK_SCREENSHOT)
				await page.screenshot({ path: process.env.E2E_ACK_SCREENSHOT });
			await page
				.getByRole("button", { name: "Menu (Esc)", exact: true })
				.click();
			await page
				.getByRole("button", {
					name: kind === "ROOM" ? "Leave Room" : "Save & Exit",
					exact: true,
				})
				.click();
			await expect(
				page.getByRole("button", { name: "New Game", exact: true }),
			).toBeVisible();
		}
		expect(errors).toEqual([]);
	} finally {
		hold = false;
		for (const deliver of held.splice(0)) deliver();
		await leaveOnline(page);
		for (const timer of timers) clearTimeout(timer);
	}
});
