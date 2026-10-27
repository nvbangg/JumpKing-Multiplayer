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
		let enteredFullscreen = false;
		let locked = false;
		let unsupportedLock = !orientation?.lock;
		const enter = async () => {
			if (disposed || !touch.matches || pending || document.hidden) return;
			pending = true;
			try {
				if (
					!enteredFullscreen &&
					!document.fullscreenElement &&
					navigator.userActivation?.isActive !== false &&
					document.documentElement.requestFullscreen
				) {
					try {
						await document.documentElement.requestFullscreen({
							navigationUI: "hide",
						});
						enteredFullscreen = true;
					} catch {
						// Thử lại trong thao tác chạm đầu tiên nếu trình duyệt yêu cầu user activation.
					}
				}
				if (disposed || locked || unsupportedLock) return;
				try {
					await orientation?.lock?.("landscape");
					if (disposed) orientation?.unlock();
					else locked = true;
				} catch (error) {
					unsupportedLock =
						Boolean(document.fullscreenElement) &&
						error instanceof DOMException &&
						error.name === "NotSupportedError";
				}
			} finally {
				pending = false;
			}
		};
		const interact = (event: Event) => {
			if (event.isTrusted) void enter();
		};
		void enter();
		window.addEventListener("click", interact);
		window.addEventListener("keydown", interact);
		return () => {
			disposed = true;
			window.removeEventListener("click", interact);
			window.removeEventListener("keydown", interact);
			if (locked) orientation?.unlock();
		};
	}, []);
}
