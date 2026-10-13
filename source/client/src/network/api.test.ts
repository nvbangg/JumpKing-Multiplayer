import { afterEach, expect, test, vi } from "vitest";
import { ApiError, api, clearCsrf } from "./api";

afterEach(() => {
	clearCsrf();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});
test("API follows the browser origin on LAN and ZeroTier without a configured backend URL", async () => {
	vi.stubGlobal("location", new URL("http://10.147.17.5:8080"));
	vi.stubEnv("VITE_BACKEND_ORIGIN", "");
	const fetcher = vi
		.fn()
		.mockResolvedValue(
			Response.json({ authenticated: false, guest: false, account: null }),
		);
	vi.stubGlobal("fetch", fetcher);
	await api("/auth/me");
	expect(fetcher).toHaveBeenCalledWith(
		"http://10.147.17.5:8080/api/auth/me",
		expect.objectContaining({ credentials: "include" }),
	);
});
test("CSRF denial clears the cached token so retry fetches a new session token", async () => {
	vi.stubGlobal("location", new URL("http://127.0.0.1:5173"));
	vi.stubEnv("VITE_BACKEND_ORIGIN", "");
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(
			Response.json({ token: "first", headerName: "X-CSRF-TOKEN" }),
		)
		.mockResolvedValueOnce(
			Response.json(
				{ error: { code: "CSRF", message: "This request is not allowed" } },
				{ status: 403 },
			),
		)
		.mockResolvedValueOnce(
			Response.json({ token: "second", headerName: "X-CSRF-TOKEN" }),
		)
		.mockResolvedValueOnce(
			Response.json({ authenticated: false, guest: true, account: null }),
		);
	vi.stubGlobal("fetch", fetcher);
	await expect(api("/auth/guest", "POST")).rejects.toMatchObject({
		code: "CSRF",
	});
	await expect(api("/auth/guest", "POST")).resolves.toMatchObject({
		guest: true,
	});
	expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
		"http://127.0.0.1:5173/api/auth/csrf",
		"http://127.0.0.1:5173/api/auth/guest",
		"http://127.0.0.1:5173/api/auth/csrf",
		"http://127.0.0.1:5173/api/auth/guest",
	]);
	expect(fetcher.mock.calls[3]![1]).toMatchObject({
		credentials: "include",
		headers: { "X-CSRF-TOKEN": "second" },
	});
});
test("invalid backend origins fail before sending credentials", async () => {
	vi.stubGlobal("location", new URL("http://127.0.0.1:5173"));
	vi.stubEnv("VITE_BACKEND_ORIGIN", "https://user:secret@example.com");
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	await expect(api("/auth/me")).rejects.toBeInstanceOf(ApiError);
	expect(fetcher).not.toHaveBeenCalled();
});
