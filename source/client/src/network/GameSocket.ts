import type { RoomItemSettings } from "../game/items";
import { required } from "../required";
import { ApiError, backendOrigin } from "./api";
import { NETWORK } from "./config";
import type { ChatMessage, NetworkQuality } from "./contracts";
import { uuid } from "./ids";
import { clearReconnect, loadReconnect, saveReconnect } from "./reconnect";

interface Message {
	v: number;
	type: string;
	payload: Record<string, unknown>;
	requestId?: string;
}
const SERVER_TYPES = new Set([
	"ROOM_JOINED",
	"ROOM_STATE",
	"ROOM_LEFT",
	"GAME_STARTED",
	"GAME_SNAPSHOT",
	"COMMUNITY_RUN_STATE",
	"SPECTATE_STATE",
	"ITEM_USED",
	"PLAYER_EFFECTS",
	"ADVENTURE_EVENTS",
	"PLAYER_FINISHED",
	"GAME_FINISHED",
	"SAVE_STATUS",
	"CHAT_MESSAGE",
	"CHAT_HISTORY",
	"RECONNECT_OK",
	"PONG",
	"ERROR",
]);
const ROOM_PACKETS = new Set([
	"SPECTATE_STATE",
	"ITEM_USED",
	"ROOM_STATE",
	"ROOM_LEFT",
	"GAME_SNAPSHOT",
	"PLAYER_EFFECTS",
	"ADVENTURE_EVENTS",
	"CHAT_MESSAGE",
	"CHAT_HISTORY",
]);
const PLAY_PACKETS = new Set([
	"PLAYER_FINISHED",
	"GAME_FINISHED",
	"SAVE_STATUS",
]);
function parseMessage(data: unknown): Message {
	if (
		typeof data !== "string" ||
		new TextEncoder().encode(data).length > NETWORK.maxMessageBytes
	)
		throw new Error("Invalid message size");
	const value: unknown = JSON.parse(data);
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid envelope");
	const message = value as Message;
	if (
		Object.keys(message).some(
			(key) => !["v", "type", "payload", "requestId"].includes(key),
		) ||
		message.v !== 1 ||
		!SERVER_TYPES.has(message.type) ||
		!message.payload ||
		typeof message.payload !== "object" ||
		Array.isArray(message.payload) ||
		(message.requestId !== undefined &&
			(typeof message.requestId !== "string" ||
				!message.requestId.length ||
				message.requestId.length > 64))
	)
		throw new Error("Invalid protocol");
	if (
		message.type === "ERROR" &&
		(typeof message.payload.code !== "string" ||
			typeof message.payload.message !== "string")
	)
		throw new Error("Invalid error");
	if (
		["ROOM_JOINED", "RECONNECT_OK"].includes(message.type) &&
		(typeof message.payload.playerId !== "string" || !message.payload.playerId)
	)
		throw new Error("Invalid player");
	return message;
}
export interface RoomMember {
	playerId: string;
	nickname: string;
	username: string | null;
	colorSlot: number;
	connected: boolean;
	paused: boolean | null;
	nextMatchConfirmed: boolean | null;
}
export interface RoomState {
	visibility?: "PRIVATE" | "PUBLIC";
	roomId: string;
	kind: "ROOM" | "COMMUNITY";
	state: "WAITING" | "COUNTDOWN" | "PLAYING" | "FINISHED";
	hostPlayerId: string | null;
	settings:
		| (RoomItemSettings & {
				mode: string;
				timeLimitMinutes: number | null;
				mapLevel?: number;
		  })
		| null;
	members: RoomMember[];
	currentPlay: Record<string, unknown> | null;
	result: unknown;
}
export interface ResultRow {
	playerId: string;
	nickname: string;
	status: string;
	rank: number;
	currentProgress: number;
	maxProgress: number;
	isWinner: boolean;
	finishTimeMs: number | null;
}
export interface MatchResult {
	mapLevel?: number;
	playId: string;
	reason: string;
	durationMs: number;
	results: ResultRow[];
	saveStatus: "PENDING" | "SAVED" | "FAILED";
}
export class GameSocket {
	private socket: WebSocket | null = null;
	private heartbeat: ReturnType<typeof setInterval> | null = null;
	private connecting: Promise<void> | null = null;
	private cancelConnect: (() => void) | null = null;
	private leaving: Promise<Message> | null = null;
	private pending = new Map<
		string,
		{
			resolve: (value: Message) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	selfId: string | null = null;
	lastSnapshot: Record<string, unknown> | null = null;
	lastFinish: Record<string, unknown> | null = null;
	playContext: { playId: string; generation: number } | null = null;
	resumeRequired = false;
	chatHistory: ChatMessage[] = [];
	private roomId: string | null = null;
	private listeners = new Set<
		(type: string, payload: Record<string, unknown>) => void
	>();
	private qualityListeners = new Set<(quality: NetworkQuality) => void>();
	private pingHistory: number[] = [];
	private lastPingMs = 0;
	private stallsCount = 0;
	private currentQuality: NetworkQuality = {
		pingMs: 0,
		avgPingMs: 0,
		jitterMs: 0,
		stalls: 0,
		status: "good",
	};

	getNetworkQuality(): NetworkQuality {
		return this.currentQuality;
	}

	subscribeQuality(listener: (quality: NetworkQuality) => void): () => void {
		this.qualityListeners.add(listener);
		listener(this.currentQuality);
		return () => {
			this.qualityListeners.delete(listener);
		};
	}

	recordPing(rtt: number): void {
		const jitter = this.lastPingMs > 0 ? Math.abs(rtt - this.lastPingMs) : 0;
		this.lastPingMs = rtt;
		this.pingHistory.push(rtt);
		if (this.pingHistory.length > 10) this.pingHistory.shift();

		const sum = this.pingHistory.reduce((a, b) => a + b, 0);
		const avg = Math.round(sum / this.pingHistory.length);

		if (rtt >= NETWORK.stallThresholdMs) {
			this.stallsCount++;
		}

		let status: "good" | "fair" | "poor" = "good";
		if (rtt > 150 || this.stallsCount > 2) {
			status = "poor";
		} else if (rtt > 60 || jitter > 30) {
			status = "fair";
		}

		this.currentQuality = {
			pingMs: rtt,
			avgPingMs: avg,
			jitterMs: jitter,
			stalls: this.stallsCount,
			status,
		};

		for (const listener of this.qualityListeners) {
			listener(this.currentQuality);
		}
		for (const listener of this.listeners) {
			listener("NETWORK_QUALITY", { ...this.currentQuality });
		}
	}

	private profile: string | null = null;
	private restoring: Promise<void> | null = null;
	async restore(profile: string): Promise<void> {
		if (this.profile !== null && this.profile !== profile) {
			this.close();
			this.restoring = null;
		}
		this.profile = profile;
		if (this.restoring) return this.restoring;
		const task = (async () => {
			await this.connect();
			if (this.selfId) return;
			const context = await loadReconnect(profile);
			if (!context) return;
			try {
				await this.command("RECONNECT", { ...context });
			} catch (error) {
				if (
					error instanceof ApiError &&
					["RECONNECT_EXPIRED", "ROOM_NOT_FOUND"].includes(error.code)
				) {
					await clearReconnect(profile);
					return;
				}
				throw error;
			}
		})();
		this.restoring = task;
		try {
			await task;
		} finally {
			if (this.restoring === task) this.restoring = null;
		}
	}
	async reconnect(): Promise<void> {
		if (!this.profile) throw new Error("Reconnect identity is unavailable");
		await this.restore(this.profile);
		// restore() xóa context hết hạn mà không báo lỗi; không có membership thì phải báo để UI rời phòng.
		if (!this.selfId)
			throw new ApiError(
				"RECONNECT_EXPIRED",
				"Reconnect is no longer available",
			);
	}
	subscribe(
		listener: (type: string, payload: Record<string, unknown>) => void,
	): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	input(
		type: "PLAYER_INPUT" | "CANCEL_INPUT",
		payload: Record<string, unknown>,
	): void {
		if (this.socket?.readyState !== WebSocket.OPEN) return;
		if (this.socket.bufferedAmount > NETWORK.maxMessageBytes * 2) {
			this.disconnect(this.socket, "Input connection is too slow");
			return;
		}
		this.socket.send(JSON.stringify({ v: 1, type, payload }));
	}
	constructor(
		private onMessage: (
			type: string,
			payload: Record<string, unknown>,
			replied?: boolean,
		) => void,
		private onDisconnect: () => void,
	) {}
	connect(): Promise<void> {
		if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
		if (this.connecting) return this.connecting;
		if (this.socket) this.close();
		this.selfId = null;
		let socket: WebSocket;
		try {
			const url = new URL("/ws/game", backendOrigin());
			url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
			socket = new WebSocket(url);
		} catch (error) {
			return Promise.reject(
				error instanceof ApiError
					? error
					: new ApiError(
							"CONNECTION_FAILED",
							"Unable to connect to the game server",
						),
			);
		}
		this.socket = socket;
		let resolve!: () => void,
			reject!: (error: Error) => void,
			settled = false;
		const connection = new Promise<void>((success, failure) => {
			resolve = success;
			reject = failure;
		});
		this.connecting = connection;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (this.connecting === connection) this.connecting = null;
			if (this.cancelConnect === cancel) this.cancelConnect = null;
			if (error) reject(error);
			else resolve();
		};
		const cancel = () =>
			finish(
				new ApiError("CONNECTION_FAILED", "The game connection was closed"),
			);
		this.cancelConnect = cancel;
		const timer = setTimeout(
			() => this.disconnect(socket, "Connection timed out"),
			NETWORK.timeoutMs,
		);
		socket.onopen = () => {
			if (this.socket !== socket) {
				cancel();
				return;
			}
			finish();
			this.heartbeat = setInterval(() => {
				if (this.socket !== socket || socket.readyState !== WebSocket.OPEN)
					return;
				const nonce = uuid();
				const start = performance.now();
				void this.command("HEARTBEAT", { nonce })
					.then((reply) => {
						if (reply.type !== "PONG" || reply.payload.nonce !== nonce) {
							this.disconnect(socket, "Invalid heartbeat", 1002);
							return;
						}
						const rtt = Math.max(0, Math.round(performance.now() - start));
						this.recordPing(rtt);
					})
					.catch(() =>
						this.disconnect(socket, "The game server is not responding"),
					);
			}, NETWORK.heartbeatMs);
		};
		socket.onerror = () =>
			this.disconnect(socket, "Unable to connect to the game server");
		socket.onclose = () =>
			this.disconnect(socket, "The game connection was closed");
		socket.onmessage = (event) => {
			if (this.socket !== socket) return;
			let message: Message;
			try {
				message = parseMessage(event.data);
			} catch {
				this.disconnect(socket, "Invalid protocol", 1002);
				return;
			}
			if (
				ROOM_PACKETS.has(message.type) &&
				this.roomId &&
				typeof message.payload.roomId === "string" &&
				message.payload.roomId !== this.roomId
			)
				return;
			if (
				PLAY_PACKETS.has(message.type) &&
				this.playContext &&
				typeof message.payload.playId === "string" &&
				message.payload.playId !== this.playContext.playId
			)
				return;
			const request = message.requestId
				? this.pending.get(message.requestId)
				: undefined;
			if (request && message.requestId) {
				clearTimeout(request.timer);
				this.pending.delete(message.requestId);
				if (message.type === "ERROR")
					request.reject(
						new ApiError(
							message.payload.code as string,
							message.payload.message as string,
						),
					);
				else request.resolve(message);
			}
			if (message.type === "ROOM_JOINED" || message.type === "RECONNECT_OK") {
				this.selfId = message.payload.playerId as string;
				this.roomId = message.payload.roomId as string;
			}
			if (message.type === "RECONNECT_OK") this.resumeRequired = true;
			if (message.type === "ROOM_JOINED" || message.type === "GAME_STARTED")
				this.resumeRequired = false;
			if (message.type === "ROOM_JOINED") this.chatHistory = [];
			if (message.type === "CHAT_HISTORY" || message.type === "CHAT_MESSAGE") {
				if (message.payload.roomId !== this.roomId) return;
				if (!Array.isArray(message.payload.messages)) {
					this.disconnect(socket, "Invalid chat history", 1002);
					return;
				}
				const items = message.payload.messages as ChatMessage[];
				if (
					items.some(
						(item) =>
							!item ||
							typeof item.id !== "string" ||
							typeof item.playerId !== "string" ||
							typeof item.nickname !== "string" ||
							typeof item.text !== "string" ||
							typeof item.sentAt !== "string" ||
							!Number.isInteger(item.colorSlot),
					)
				) {
					this.disconnect(socket, "Invalid chat message", 1002);
					return;
				}
				const merged = new Map(
					(message.type === "CHAT_HISTORY" ? [] : this.chatHistory).map(
						(item) => [item.id, item],
					),
				);
				for (const item of items) merged.set(item.id, item);
				this.chatHistory = [...merged.values()].slice(-NETWORK.chatHistory);
			}
			if (message.type === "ROOM_JOINED" && this.profile)
				void saveReconnect(this.profile, message.payload).catch(() =>
					this.onMessage("ERROR", {
						code: "STORAGE_UNAVAILABLE",
						message: "Reconnect context could not be saved on this device",
					}),
				);
			if (message.type === "ROOM_LEFT" && this.profile)
				void clearReconnect(this.profile).catch(() =>
					this.onMessage("ERROR", {
						code: "STORAGE_UNAVAILABLE",
						message: "Reconnect context could not be cleared on this device",
					}),
				);
			if (message.type === "GAME_SNAPSHOT") this.lastSnapshot = message.payload;
			if (message.type === "PLAYER_FINISHED") this.lastFinish = message.payload;
			if (message.type === "ROOM_LEFT") {
				this.lastFinish = null;
				this.selfId = null;
				this.roomId = null;
				this.playContext = null;
			}
			if (
				[
					"ROOM_JOINED",
					"RECONNECT_OK",
					"GAME_STARTED",
					"COMMUNITY_RUN_STATE",
				].includes(message.type)
			) {
				const run = message.payload.run as { id?: unknown } | undefined;
				const playId =
						message.type === "COMMUNITY_RUN_STATE"
							? run?.id
							: message.payload.playId,
					generation = message.payload.generation;
				if (
					typeof playId === "string" &&
					typeof generation === "number" &&
					Number.isSafeInteger(generation) &&
					generation > 0
				) {
					if (this.lastFinish && this.lastFinish.playId !== playId)
						this.lastFinish = null;
					this.playContext = { playId, generation };
				}
			}
			this.onMessage(
				message.type,
				message.payload,
				message.requestId !== undefined,
			);
			for (const listener of this.listeners)
				listener(message.type, message.payload);
		};
		return connection;
	}
	command(
		type: string,
		payload: Record<string, unknown> = {},
	): Promise<Message> {
		if (type === "LEAVE_ROOM" && this.leaving) return this.leaving;
		if (this.socket?.readyState !== WebSocket.OPEN)
			return Promise.reject(
				new ApiError("CONNECTION_FAILED", "The game connection is unavailable"),
			);
		if (this.pending.size >= NETWORK.maxPending)
			return Promise.reject(
				new ApiError("RATE_LIMITED", "Too many pending commands"),
			);
		const requestId = uuid();
		const request = new Promise<Message>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(requestId);
				reject(
					new ApiError(
						"COMMAND_TIMEOUT",
						"The server has not confirmed this action",
					),
				);
			}, NETWORK.timeoutMs);
			this.pending.set(requestId, { resolve, reject, timer });
			try {
				const message = JSON.stringify({ v: 1, type, requestId, payload });
				if (new TextEncoder().encode(message).length > NETWORK.maxMessageBytes)
					throw new Error("Message is too large");
				required(this.socket).send(message);
			} catch {
				clearTimeout(timer);
				this.pending.delete(requestId);
				reject(
					new ApiError("INVALID_MESSAGE", "The command could not be sent"),
				);
			}
		});
		if (type === "LEAVE_ROOM") {
			this.leaving = request;
			const settled = () => {
				if (this.leaving === request) this.leaving = null;
			};
			void request.then(settled, settled);
		}
		return request;
	}
	private clearPending(): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(
				new ApiError("CONNECTION_FAILED", "The game connection was closed"),
			);
		}
		this.pending.clear();
	}
	close(code = 1000, reason = ""): void {
		const socket = this.socket;
		this.socket = null;
		this.cancelConnect?.();
		this.cancelConnect = null;
		this.selfId = null;
		this.lastSnapshot = null;
		this.playContext = null;
		this.leaving = null;
		if (this.heartbeat) clearInterval(this.heartbeat);
		this.heartbeat = null;
		this.clearPending();
		socket?.close(code, reason);
	}
	fail(message: string): void {
		if (this.socket) this.disconnect(this.socket, message, 4000);
	}
	private disconnect(socket: WebSocket, message: string, code?: number): void {
		if (this.socket !== socket) return;
		this.close(code ?? 1000, message);
		for (const listener of this.listeners)
			listener("CONNECTION_CLOSED", { message });
		this.onDisconnect();
	}
}
