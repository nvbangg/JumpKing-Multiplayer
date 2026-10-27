import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { reconnectLobby } from "./reconnectLobby";

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("window", new EventTarget());
	vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test("Lobby retries at increasing intervals and stops after five failures", async () => {
	const retry = vi.fn(async () => {
		throw new Error("Offline");
	});
	const stop = reconnectLobby(retry);
	for (let index = 0; index < 5; index++) {
		await vi.advanceTimersByTimeAsync(1000 * 2 ** index - 1);
		expect(retry).toHaveBeenCalledTimes(index);
		await vi.advanceTimersByTimeAsync(1);
		expect(retry).toHaveBeenCalledTimes(index + 1);
	}
	window.dispatchEvent(new Event("online"));
	await vi.advanceTimersByTimeAsync(120000);
	expect(retry).toHaveBeenCalledTimes(5);
	stop();
});

test("Lobby waits offline, restores when online and does not reconnect again after success", async () => {
	vi.stubGlobal("navigator", { onLine: false });
	const retry = vi.fn(async () => {});
	const stop = reconnectLobby(retry);
	await vi.advanceTimersByTimeAsync(60000);
	expect(retry).not.toHaveBeenCalled();
	vi.stubGlobal("navigator", { onLine: true });
	window.dispatchEvent(new Event("online"));
	await vi.advanceTimersByTimeAsync(1000);
	expect(retry).toHaveBeenCalledOnce();
	window.dispatchEvent(new Event("online"));
	await vi.advanceTimersByTimeAsync(60000);
	expect(retry).toHaveBeenCalledOnce();
	stop();
});

test("Leaving or kicking cleans the timer and online listener, including a pending attempt", async () => {
	let reject!: (cause: Error) => void;
	const retry = vi.fn(
		() => new Promise<void>((_, failure) => (reject = failure)),
	);
	const stop = reconnectLobby(retry);
	await vi.advanceTimersByTimeAsync(1000);
	window.dispatchEvent(new Event("online"));
	await vi.advanceTimersByTimeAsync(30000);
	expect(retry).toHaveBeenCalledOnce();
	stop();
	reject(new Error("Connection closed"));
	window.dispatchEvent(new Event("online"));
	await vi.advanceTimersByTimeAsync(60000);
	expect(retry).toHaveBeenCalledOnce();
	expect(vi.getTimerCount()).toBe(0);
});

test("Unmount before the first retry prevents every later attempt", async () => {
	const retry = vi.fn(async () => {});
	const stop = reconnectLobby(retry);
	stop();
	window.dispatchEvent(new Event("online"));
	await vi.advanceTimersByTimeAsync(60000);
	expect(retry).not.toHaveBeenCalled();
});
