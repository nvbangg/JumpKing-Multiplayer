import { NETWORK } from "./config";
export class ApiError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}
export function backendOrigin(): string {
	const configured = import.meta.env.VITE_BACKEND_ORIGIN;
	if (!configured) return location.origin;
	const url = new URL(configured);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.pathname !== "/" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new ApiError("CONFIGURATION", "Backend origin is invalid");
	return url.origin;
}
let csrf: { token: string; headerName: string } | null = null;
export function clearCsrf(): void {
	csrf = null;
}
export async function api<T>(
	path: string,
	method = "GET",
	body?: unknown,
): Promise<T> {
	if (!path.startsWith("/") || path.startsWith("//"))
		throw new Error("Invalid API path");
	if (method !== "GET" && !csrf) {
		csrf = await api("/auth/csrf");
		if (
			!csrf ||
			typeof csrf.token !== "string" ||
			typeof csrf.headerName !== "string"
		) {
			csrf = null;
			throw new ApiError(
				"PROTOCOL_ERROR",
				"The server returned an invalid CSRF response",
			);
		}
	}
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), NETWORK.timeoutMs);
	try {
		const response = await fetch(backendOrigin() + "/api" + path, {
			method,
			credentials: "include",
			signal: controller.signal,
			headers: {
				Accept: "application/json",
				...(body !== undefined ? { "Content-Type": "application/json" } : {}),
				...(method !== "GET" && csrf ? { [csrf.headerName]: csrf.token } : {}),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const contentType = response.headers.get("Content-Type") || "";
		const result = contentType.includes("application/json")
			? await response.json()
			: null;
		if (!response.ok) {
			if (
				result?.error?.code === "CSRF" ||
				result?.error?.code === "SESSION_EXPIRED"
			)
				clearCsrf();
			throw new ApiError(
				result?.error?.code || "HTTP_ERROR",
				result?.error?.message || "The server could not complete this request",
			);
		}
		if (!result || typeof result !== "object")
			throw new ApiError(
				"PROTOCOL_ERROR",
				"The server returned an invalid response",
			);
		return result;
	} catch (error) {
		if (error instanceof ApiError) throw error;
		throw new ApiError("CONNECTION_FAILED", "Unable to connect to the server");
	} finally {
		clearTimeout(timeout);
	}
}
