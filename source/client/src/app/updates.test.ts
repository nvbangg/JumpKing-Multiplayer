import { afterEach, expect, test, vi } from "vitest";
import { newerVersion, watchForUpdate } from "./updates";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test("release check omits session cookies and ignores unchanged, malformed or unavailable metadata", async () => {
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	const signal = new AbortController().signal;
	fetcher.mockResolvedValue(new Response(JSON.stringify({ version: "next" })));
	expect(await newerVersion("current", signal)).toBe(true);
	expect(fetcher).toHaveBeenCalledWith("/version.json", {
		cache: "no-store",
		credentials: "omit",
		signal,
	});
	for (const value of [
		{ version: "current" },
		{ version: "" },
		{ version: 3 },
		null,
		{},
	]) {
		fetcher.mockResolvedValue(new Response(JSON.stringify(value)));
		expect(await newerVersion("current", signal)).toBe(false);
	}
	fetcher.mockResolvedValue(new Response("Unavailable", { status: 503 }));
	expect(await newerVersion("current", signal)).toBe(false);
	fetcher.mockRejectedValue(new TypeError("Offline"));
	expect(await newerVersion("current", signal)).toBe(false);
});

test("polling skips hidden tabs, wakes on focus and stops without late updates", async () => {
	vi.useFakeTimers();
	const document = Object.assign(new EventTarget(), { hidden: true });
	const window = new EventTarget();
	vi.stubGlobal("document", document);
	vi.stubGlobal("window", window);
	const fetcher = vi
		.fn()
		.mockResolvedValue(new Response(JSON.stringify({ version: "next" })));
	vi.stubGlobal("fetch", fetcher);
	const available = vi.fn();
	const stop = watchForUpdate("current", available);
	await vi.advanceTimersByTimeAsync(60_000);
	expect(fetcher).not.toHaveBeenCalled();
	document.hidden = false;
	window.dispatchEvent(new Event("focus"));
	await vi.advanceTimersByTimeAsync(0);
	expect(available).toHaveBeenCalledOnce();
	await vi.advanceTimersByTimeAsync(120_000);
	expect(fetcher).toHaveBeenCalledOnce();
	stop();
	expect(vi.getTimerCount()).toBe(0);
	window.dispatchEvent(new Event("focus"));
	expect(fetcher).toHaveBeenCalledOnce();
});
