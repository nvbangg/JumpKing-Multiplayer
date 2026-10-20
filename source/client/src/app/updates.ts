import { NETWORK } from "../network/config";

/** Đọc static metadata riêng; không gửi cookie hoặc gia hạn phiên đăng nhập. */
export async function newerVersion(
	current: string,
	signal: AbortSignal,
): Promise<boolean> {
	try {
		const response = await fetch("/version.json", {
			cache: "no-store",
			credentials: "omit",
			signal,
		});
		if (!response.ok) return false;
		const value: unknown = await response.json();
		return (
			!!value &&
			typeof value === "object" &&
			"version" in value &&
			typeof value.version === "string" &&
			value.version.length > 0 &&
			value.version !== current
		);
	} catch {
		return false;
	}
}

export function watchForUpdate(
	current: string,
	available: () => void,
): () => void {
	let controller: AbortController | null = null;
	let found = false,
		disposed = false;
	const check = async () => {
		if (disposed || found || document.hidden || controller) return;
		const request = new AbortController();
		controller = request;
		const timeout = setTimeout(() => request.abort(), NETWORK.timeoutMs);
		try {
			if (await newerVersion(current, request.signal)) {
				if (!disposed) {
					found = true;
					available();
				}
			}
		} finally {
			clearTimeout(timeout);
			if (controller === request) controller = null;
		}
	};
	const wake = () => {
		void check();
	};
	const timer = setInterval(wake, 60_000);
	document.addEventListener("visibilitychange", wake);
	window.addEventListener("focus", wake);
	wake();
	return () => {
		disposed = true;
		clearInterval(timer);
		controller?.abort();
		document.removeEventListener("visibilitychange", wake);
		window.removeEventListener("focus", wake);
	};
}
