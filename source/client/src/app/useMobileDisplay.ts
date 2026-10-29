import { useEffect } from "react";

type LockableOrientation = ScreenOrientation & {
	lock?: (orientation: "landscape") => Promise<void>;
};

export async function requestLandscape(active = () => true): Promise<boolean> {
	try {
		if (!document.fullscreenElement)
			await document.documentElement.requestFullscreen?.({
				navigationUI: "hide",
			});
	} catch {
		// Browser có thể yêu cầu thao tác chạm trước khi cho fullscreen.
	}
	const orientation = screen.orientation as LockableOrientation | undefined;
	if (active() && orientation?.lock)
		try {
			await orientation.lock("landscape");
			return true;
		} catch {
			// Giữ màn hình nhắc xoay ngang nếu browser từ chối khóa hướng.
		}
	return false;
}

export function useMobileDisplay() {
	useEffect(() => {
		const touch = matchMedia("(pointer: coarse)");
		const orientation = screen.orientation;
		let disposed = false;
		let pending = false;
		let locked = false;
		const enterLandscape = async () => {
			if (disposed || !touch.matches || pending || locked || document.hidden)
				return;
			pending = true;
			try {
				locked =
					(await requestLandscape(() => !disposed)) &&
					!!document.fullscreenElement;
				if (disposed && locked) orientation?.unlock();
			} finally {
				pending = false;
			}
		};
		const updateFullscreen = () => {
			if (!document.fullscreenElement) locked = false;
		};
		const retryAfterGesture = (event: Event) => {
			if (event.isTrusted) void enterLandscape();
		};
		void enterLandscape();
		document.addEventListener("fullscreenchange", updateFullscreen);
		window.addEventListener("click", retryAfterGesture);
		window.addEventListener("keydown", retryAfterGesture);
		return () => {
			disposed = true;
			document.removeEventListener("fullscreenchange", updateFullscreen);
			window.removeEventListener("click", retryAfterGesture);
			window.removeEventListener("keydown", retryAfterGesture);
			if (locked) orientation?.unlock();
		};
	}, []);
}
