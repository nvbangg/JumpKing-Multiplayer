import { useEffect } from "react";

type LockableOrientation = ScreenOrientation & {
	lock?: (orientation: "landscape") => Promise<void>;
};

export function useMobileDisplay() {
	useEffect(() => {
		const touch = matchMedia("(pointer: coarse)");
		const orientation = screen.orientation as LockableOrientation | undefined;
		let disposed = false;
		let pending = false;
		let locked = false;
		const enterLandscape = async () => {
			if (disposed || !touch.matches || pending || locked || document.hidden)
				return;
			pending = true;
			try {
				if (
					!document.fullscreenElement &&
					document.documentElement.requestFullscreen
				)
					try {
						await document.documentElement.requestFullscreen({
							navigationUI: "hide",
						});
					} catch {
						// Browser có thể yêu cầu thao tác chạm trước khi cho fullscreen.
					}
				if (!disposed && orientation?.lock)
					try {
						await orientation.lock("landscape");
						locked = true;
					} catch {
						// Giữ màn hình nhắc xoay ngang nếu browser từ chối khóa hướng.
					}
			} finally {
				pending = false;
			}
		};
		const retryAfterGesture = (event: Event) => {
			if (event.isTrusted) void enterLandscape();
		};
		void enterLandscape();
		window.addEventListener("click", retryAfterGesture);
		window.addEventListener("keydown", retryAfterGesture);
		return () => {
			disposed = true;
			window.removeEventListener("click", retryAfterGesture);
			window.removeEventListener("keydown", retryAfterGesture);
			if (locked) orientation?.unlock();
		};
	}, []);
}
