import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { required } from "../required";
import { NETWORK } from "./config";
import { GameSocket } from "./GameSocket";
import { clearReconnect, loadReconnect } from "./reconnect";

vi.mock("./reconnect", () => ({
	clearReconnect: vi.fn(async () => {}),
	loadReconnect: vi.fn(async () => null),
	saveReconnect: vi.fn(async () => {}),
}));

class Socket {
	static OPEN = 1;
	static instances: Socket[] = [];
	readyState = 0;
	sent: string[] = [];
	url: string;
	closeCode?: number;
	failSend = false;
	onopen?: () => void;
	onclose?: () => void;
	onerror?: () => void;
	onmessage?: (event: { data: unknown }) => void;
	constructor(url: string) {
		this.url = String(url);
		Socket.instances.push(this);
	}
	open() {
		this.readyState = 1;
		this.onopen?.();
	}
	send(message: string) {
		if (this.failSend) throw new Error("Closed during send");
		this.sent.push(message);
	}
	close(code?: number) {
		this.closeCode = code;
		this.readyState = 3;
		this.onclose?.();
	}
	receive(message: unknown) {
		this.onmessage?.({
			data: typeof message === "string" ? message : JSON.stringify(message),
		});
	}
}
beforeEach(() => {
	vi.useFakeTimers();
	Socket.instances = [];
	vi.stubGlobal("WebSocket", Socket);
	vi.stubGlobal("location", new URL("http://127.0.0.1:5173"));
	vi.stubEnv("VITE_BACKEND_ORIGIN", "");
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});
const open = async (game: GameSocket) => {
	const ready = game.connect();
	const socket = required(Socket.instances.at(-1));
	socket.open();
	await ready;
	return socket;
};
test("input failure notifies disconnect once and rejects commands without accepting stale packets", async () => {
	const received = vi.fn(),
		disconnected = vi.fn(),
		listener = vi.fn();
	const game = new GameSocket(received, disconnected);
	game.subscribe(listener);
	const socket = await open(game);
	const command = game.command("GET_ROOM_STATE");
	const rejected = expect(command).rejects.toMatchObject({
		code: "CONNECTION_FAILED",
	});
	game.fail("Input acknowledgements are too far behind; reconnect to continue");
	game.fail("Repeated failure");
	await rejected;
	expect(socket.closeCode).toBe(4000);
	expect(disconnected).toHaveBeenCalledTimes(1);
	expect(listener).toHaveBeenCalledExactlyOnceWith("CONNECTION_CLOSED", {
		message: "Input acknowledgements are too far behind; reconnect to continue",
	});
	socket.receive({ v: 1, type: "ROOM_LEFT", payload: {} });
	expect(received).not.toHaveBeenCalled();
	await expect(game.command("LEAVE_ROOM")).rejects.toMatchObject({
		code: "CONNECTION_FAILED",
	});
});
test("WebSocket follows the browser origin and uses WSS for an explicitly configured HTTPS backend", async () => {
	vi.stubGlobal("location", new URL("http://10.147.17.5:8080"));
	const game = new GameSocket(vi.fn(), vi.fn());
	expect((await open(game)).url).toBe("ws://10.147.17.5:8080/ws/game");
	game.close();
	vi.stubEnv("VITE_BACKEND_ORIGIN", "https://api.example.test");
	expect((await open(game)).url).toBe("wss://api.example.test/ws/game");
	game.close();
});
test("packets from a previous room or play cannot replace current chat, state or save status", async () => {
	const received = vi.fn(),
		game = new GameSocket(received, vi.fn()),
		socket = await open(game);
	const send = (type: string, payload: Record<string, unknown>) =>
		socket.receive({ v: 1, type, payload });
	send("ROOM_JOINED", {
		roomId: "ABCDEF",
		playerId: "self",
		playId: "first",
		generation: 1,
	});
	const message = {
		id: "message",
		playerId: "self",
		nickname: "Player",
		text: "<b>hello</b>",
		sentAt: "2026-01-01T00:00:00.000Z",
		colorSlot: 0,
	};
	send("CHAT_MESSAGE", { roomId: "ABCDEF", messages: [message] });
	expect(game.chatHistory).toHaveLength(1);
	send("ROOM_JOINED", {
		roomId: "GHJKLM",
		playerId: "new-self",
		playId: "second",
		generation: 2,
	});
	received.mockClear();
	send("CHAT_MESSAGE", { roomId: "ABCDEF", messages: [message] });
	send("ROOM_STATE", { roomId: "ABCDEF" });
	send("ROOM_LEFT", { roomId: "ABCDEF" });
	send("SAVE_STATUS", { playId: "first", saveStatus: "SAVED" });
	send("GAME_FINISHED", { playId: "first" });
	expect(received).not.toHaveBeenCalled();
	expect(game.chatHistory).toEqual([]);
	send("CHAT_MESSAGE", { roomId: "GHJKLM", messages: [message] });
	expect(game.chatHistory).toEqual([message]);
	game.close();
});

test("chat deduplicates messages and bounds its history to the latest ten", async () => {
	const game = new GameSocket(vi.fn(), vi.fn());
	const socket = await open(game);
	socket.receive({
		v: 1,
		type: "ROOM_JOINED",
		payload: { roomId: "ABCDEF", playerId: "self" },
	});
	for (let index = 0; index < 12; index++) {
		const packet = {
			v: 1,
			type: "CHAT_MESSAGE",
			payload: {
				roomId: "ABCDEF",
				messages: [
					{
						id: String(index),
						playerId: "self",
						nickname: "Player",
						text: `message-${index}`,
						sentAt: "2026-01-01T00:00:00Z",
						colorSlot: 0,
					},
				],
			},
		};
		socket.receive(packet);
		socket.receive(packet);
	}
	expect(game.chatHistory.map((message) => message.id)).toEqual(
		Array.from({ length: 10 }, (_, index) => String(index + 2)),
	);
	game.close();
});

test("parallel connects share one handshake and stale sockets cannot affect the new connection", async () => {
	const message = vi.fn(),
		disconnect = vi.fn(),
		game = new GameSocket(message, disconnect);
	const first = game.connect(),
		second = game.connect();
	expect(first).toBe(second);
	expect(Socket.instances).toHaveLength(1);
	const old = required(Socket.instances[0]);
	old.open();
	await first;
	expect(old.url).toBe("ws://127.0.0.1:5173/ws/game");
	game.close();
	const next = await open(game);
	old.onerror?.();
	old.receive({ v: 1, type: "ROOM_JOINED", payload: { playerId: "old" } });
	expect(message).not.toHaveBeenCalled();
	expect(disconnect).not.toHaveBeenCalled();
	expect(game.selfId).toBeNull();
	const pending = game.command("GET_ROOM_STATE");
	const request = JSON.parse(required(next.sent[0]));
	next.receive({
		v: 1,
		type: "ROOM_STATE",
		requestId: request.requestId,
		payload: {},
	});
	await expect(pending).resolves.toMatchObject({ type: "ROOM_STATE" });
	game.close();
});

test("malformed chat cannot enter the typed history or reach subscribers", async () => {
	const valid = {
		id: "m",
		playerId: "peer",
		nickname: "Peer",
		text: "Hello",
		sentAt: "2026-01-01T00:00:00Z",
		colorSlot: 1,
	};
	for (const messages of [
		null,
		{},
		[null],
		[{ ...valid, text: 42 }],
		[{ ...valid, colorSlot: "1" }],
	]) {
		const received = vi.fn(),
			disconnected = vi.fn(),
			game = new GameSocket(received, disconnected),
			socket = await open(game);
		socket.receive({
			v: 1,
			type: "ROOM_JOINED",
			payload: { roomId: "ABCDEF", playerId: "self" },
		});
		received.mockClear();
		socket.receive({
			v: 1,
			type: "CHAT_MESSAGE",
			payload: { roomId: "ABCDEF", messages },
		});
		expect(socket.closeCode).toBe(1002);
		expect(disconnected).toHaveBeenCalledOnce();
		expect(game.chatHistory).toEqual([]);
		expect(received).not.toHaveBeenCalled();
	}
});
test("closing during handshake rejects immediately and does not start a stale heartbeat", async () => {
	const game = new GameSocket(vi.fn(), vi.fn()),
		ready = game.connect();
	const rejected = expect(ready).rejects.toMatchObject({
		code: "CONNECTION_FAILED",
	});
	const old = required(Socket.instances[0]);
	game.close();
	await rejected;
	old.open();
	vi.advanceTimersByTime(NETWORK.heartbeatMs * 2);
	expect(old.sent).toEqual([]);
});
test("reconnecting before the old close event rejects old pending commands", async () => {
	const game = new GameSocket(vi.fn(), vi.fn()),
		old = await open(game),
		pending = game.command("GET_ROOM_STATE");
	const rejected = expect(pending).rejects.toMatchObject({
		code: "CONNECTION_FAILED",
	});
	old.readyState = 3;
	const next = game.connect();
	required(Socket.instances.at(-1)).open();
	await next;
	await rejected;
	old.onclose?.();
	const command = game.command("GET_ROOM_STATE"),
		socket = required(Socket.instances.at(-1)),
		request = JSON.parse(required(socket.sent[0]));
	socket.receive({
		v: 1,
		type: "ROOM_STATE",
		requestId: request.requestId,
		payload: {},
	});
	await expect(command).resolves.toMatchObject({ type: "ROOM_STATE" });
	game.close();
});
test("invalid envelopes close the socket and reject pending commands", async () => {
	for (const packet of [
		null,
		[],
		{ v: 1, type: "PONG", payload: [] },
		{ v: 1, type: "PONG", payload: {}, extra: true },
		{ v: 1, type: "PONG", payload: {}, requestId: 7 },
	]) {
		const disconnect = vi.fn(),
			game = new GameSocket(vi.fn(), disconnect),
			socket = await open(game),
			pending = game.command("GET_ROOM_STATE");
		const rejected = expect(pending).rejects.toMatchObject({
			code: "CONNECTION_FAILED",
		});
		socket.receive(packet);
		await rejected;
		expect(socket.closeCode).toBe(1002);
		expect(disconnect).toHaveBeenCalledOnce();
	}
});
test("heartbeat confirms nonce and a silent connection expires without leaking commands", async () => {
	const disconnected = vi.fn(),
		game = new GameSocket(vi.fn(), disconnected),
		socket = await open(game);
	await vi.advanceTimersByTimeAsync(NETWORK.heartbeatMs);
	const ping = JSON.parse(required(socket.sent[0]));
	socket.receive({
		v: 1,
		type: "PONG",
		requestId: ping.requestId,
		payload: { nonce: ping.payload.nonce },
	});
	await Promise.resolve();
	expect(disconnected).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(NETWORK.heartbeatMs + NETWORK.timeoutMs);
	expect(disconnected).toHaveBeenCalledOnce();
	expect(socket.readyState).toBe(3);
});
test("failed sends release pending slots and timeout does not replay mutations", async () => {
	const game = new GameSocket(vi.fn(), vi.fn()),
		socket = await open(game);
	socket.failSend = true;
	for (let index = 0; index < NETWORK.maxPending + 1; index++)
		await expect(game.command("START_GAME")).rejects.toMatchObject({
			code: "INVALID_MESSAGE",
		});
	socket.failSend = false;
	const pending = game.command("START_GAME"),
		rejected = expect(pending).rejects.toMatchObject({
			code: "COMMAND_TIMEOUT",
		});
	await vi.advanceTimersByTimeAsync(NETWORK.timeoutMs);
	await rejected;
	expect(socket.sent).toHaveLength(1);
	game.close();
});
test("network quality tracks ping, average, jitter, stalls, and notifies subscribers", async () => {
	const game = new GameSocket(vi.fn(), vi.fn());
	const qualities: unknown[] = [];
	const unsubscribe = game.subscribeQuality((q) => qualities.push(q));

	expect(qualities).toHaveLength(1);
	expect(game.getNetworkQuality().pingMs).toBe(0);

	game.recordPing(40);
	expect(game.getNetworkQuality()).toMatchObject({
		pingMs: 40,
		avgPingMs: 40,
		jitterMs: 0,
		stalls: 0,
		status: "good",
	});

	game.recordPing(50);
	expect(game.getNetworkQuality()).toMatchObject({
		pingMs: 50,
		avgPingMs: 45,
		jitterMs: 10,
		stalls: 0,
		status: "good",
	});

	game.recordPing(550);
	expect(game.getNetworkQuality()).toMatchObject({
		pingMs: 550,
		stalls: 1,
		status: "poor",
	});

	unsubscribe();
	game.recordPing(30);
	expect(qualities).toHaveLength(4);
});

test("Leave is shared until acknowledgement and clears membership before notifying the app", async () => {
	let memberAtLeave: string | null = "unconfirmed";
	const game = new GameSocket((type) => {
		if (type === "ROOM_LEFT") memberAtLeave = game.selfId;
	}, vi.fn());
	const socket = await open(game);
	socket.receive({
		v: 1,
		type: "ROOM_JOINED",
		payload: { roomId: "ABCDEF", playerId: "self" },
	});
	const first = game.command("LEAVE_ROOM"),
		second = game.command("LEAVE_ROOM");
	expect(second).toBe(first);
	expect(socket.sent).toHaveLength(1);
	expect(socket.readyState).toBe(Socket.OPEN);
	const request = JSON.parse(required(socket.sent[0]));
	socket.receive({
		v: 1,
		type: "ROOM_LEFT",
		requestId: request.requestId,
		payload: { roomId: "ABCDEF" },
	});
	await expect(first).resolves.toMatchObject({ type: "ROOM_LEFT" });
	expect(memberAtLeave).toBeNull();
	game.close();
});

test("a failed Save and Exit keeps membership and allows one fresh Leave retry", async () => {
	const game = new GameSocket(vi.fn(), vi.fn()),
		socket = await open(game);
	socket.receive({
		v: 1,
		type: "ROOM_JOINED",
		payload: { roomId: "ABCDEF", playerId: "self" },
	});
	const first = game.command("LEAVE_ROOM"),
		rejected = expect(first).rejects.toMatchObject({ code: "SAVE_FAILED" }),
		request = JSON.parse(required(socket.sent[0]));
	socket.receive({
		v: 1,
		type: "ERROR",
		requestId: request.requestId,
		payload: { code: "SAVE_FAILED", message: "Retry saving" },
	});
	await rejected;
	expect(game.selfId).toBe("self");
	expect(socket.readyState).toBe(Socket.OPEN);
	const retry = game.command("LEAVE_ROOM");
	expect(retry).not.toBe(first);
	expect(game.command("LEAVE_ROOM")).toBe(retry);
	expect(socket.sent).toHaveLength(2);
	const closed = expect(retry).rejects.toMatchObject({
		code: "CONNECTION_FAILED",
	});
	game.close();
	await closed;
});

test("closing an old Leave does not reuse it on a replacement connection", async () => {
	const game = new GameSocket(vi.fn(), vi.fn()),
		old = await open(game),
		first = game.command("LEAVE_ROOM"),
		rejected = expect(first).rejects.toMatchObject({
			code: "CONNECTION_FAILED",
		});
	game.close();
	const next = await open(game),
		leave = game.command("LEAVE_ROOM");
	await rejected;
	old.onclose?.();
	expect(game.command("LEAVE_ROOM")).toBe(leave);
	expect(next.sent).toHaveLength(1);
	expect(next.readyState).toBe(Socket.OPEN);
	const closed = expect(leave).rejects.toMatchObject({
		code: "CONNECTION_FAILED",
	});
	game.close();
	await closed;
});

test("server-initiated ROOM_LEFT is reported as unsolicited and a replied one is not", async () => {
	const received = vi.fn(),
		game = new GameSocket(received, vi.fn()),
		socket = await open(game);
	socket.receive({
		v: 1,
		type: "ROOM_JOINED",
		payload: { roomId: "ABCDEF", playerId: "self" },
	});
	socket.receive({ v: 1, type: "ROOM_LEFT", payload: { roomId: "ABCDEF" } });
	expect(received).toHaveBeenLastCalledWith(
		"ROOM_LEFT",
		{ roomId: "ABCDEF" },
		false,
	);
	socket.receive({
		v: 1,
		type: "ROOM_LEFT",
		requestId: "answer",
		payload: { roomId: "ABCDEF" },
	});
	expect(received).toHaveBeenLastCalledWith(
		"ROOM_LEFT",
		{ roomId: "ABCDEF" },
		true,
	);
	game.close();
});

test("Reconnect rejects when the room membership no longer exists", async () => {
	const game = new GameSocket(vi.fn(), vi.fn()),
		restoring = game.restore("profile"),
		socket = required(Socket.instances.at(-1));
	socket.open();
	await restoring;
	await expect(game.reconnect()).rejects.toMatchObject({
		code: "RECONNECT_EXPIRED",
	});
	game.close();
});

test("Reconnect resolves once the server restores the membership", async () => {
	const game = new GameSocket(vi.fn(), vi.fn()),
		restoring = game.restore("profile"),
		socket = required(Socket.instances.at(-1));
	socket.open();
	await restoring;
	vi.mocked(loadReconnect).mockResolvedValueOnce({
		roomId: "ABCDEF",
		playerId: "11111111-1111-4111-8111-111111111111",
		reconnectToken: "token",
	});
	const attempt = game.reconnect();
	await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
	const request = JSON.parse(required(socket.sent[0]));
	expect(request.type).toBe("RECONNECT");
	socket.receive({
		v: 1,
		type: "RECONNECT_OK",
		requestId: request.requestId,
		payload: { roomId: "ABCDEF", playerId: "self" },
	});
	await expect(attempt).resolves.toBeUndefined();
	expect(game.selfId).toBe("self");
	game.close();
});

test.each(["RECONNECT_EXPIRED", "ROOM_NOT_FOUND"])(
	"Reconnect clears stored context and rejects when the server reports %s",
	async (code) => {
		vi.mocked(clearReconnect).mockClear();
		const game = new GameSocket(vi.fn(), vi.fn()),
			restoring = game.restore("profile"),
			socket = required(Socket.instances.at(-1));
		socket.open();
		await restoring;
		vi.mocked(loadReconnect).mockResolvedValueOnce({
			roomId: "ABCDEF",
			playerId: "11111111-1111-4111-8111-111111111111",
			reconnectToken: "token",
		});
		const attempt = game.reconnect();
		const rejected = expect(attempt).rejects.toMatchObject({
			code: "RECONNECT_EXPIRED",
		});
		await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
		const request = JSON.parse(required(socket.sent[0]));
		socket.receive({
			v: 1,
			type: "ERROR",
			requestId: request.requestId,
			payload: { code, message: "Membership has ended" },
		});
		await rejected;
		expect(clearReconnect).toHaveBeenCalledExactlyOnceWith("profile");
		expect(game.selfId).toBeNull();
		game.close();
	},
);
