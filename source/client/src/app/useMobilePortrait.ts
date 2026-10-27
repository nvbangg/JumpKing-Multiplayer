import { useSyncExternalStore } from "react";

function isMobilePortrait() {
	if (!matchMedia("(pointer: coarse)").matches) return false;
	// Dùng hướng thiết bị để bàn phím ảo không làm bỏ chặn màn hình dọc.
	const direction = screen.orientation?.type;
	if (direction) return direction.startsWith("portrait");
	return screen.width && screen.height
		? screen.height > screen.width
		: matchMedia("(orientation: portrait)").matches;
}

function subscribe(update: () => void) {
	const touch = matchMedia("(pointer: coarse)");
	const vertical = matchMedia("(orientation: portrait)");
	const orientation = screen.orientation;
	touch.addEventListener("change", update);
	vertical.addEventListener("change", update);
	orientation?.addEventListener("change", update);
	return () => {
		touch.removeEventListener("change", update);
		vertical.removeEventListener("change", update);
		orientation?.removeEventListener("change", update);
	};
}

export function useMobilePortrait() {
	return useSyncExternalStore(subscribe, isMobilePortrait, () => false);
}
