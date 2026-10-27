import { expect, test } from "@playwright/test";

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
