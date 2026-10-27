import { useEffect, useRef } from "react";

// Thiết bị không khóa được hướng vẫn dùng Pause Menu bình thường, không có trang chặn xoay máy.
export function usePortraitPause(enabled: boolean, onPortrait: () => void) {
	const pause = useRef(onPortrait);
	pause.current = onPortrait;
	useEffect(() => {
		if (!enabled) return;
		const touch = matchMedia("(pointer: coarse)");
		const vertical = matchMedia("(orientation: portrait)");
		const orientation = screen.orientation;
		let wasPortrait = false;
		const update = () => {
			// Bàn phím ảo không thay đổi hướng vật lý của thiết bị.
			const portrait =
				touch.matches &&
				(orientation?.type.startsWith("portrait") || vertical.matches);
			if (portrait && !wasPortrait) pause.current();
			wasPortrait = portrait;
		};
		update();
		touch.addEventListener("change", update);
		vertical.addEventListener("change", update);
		orientation?.addEventListener("change", update);
		return () => {
			touch.removeEventListener("change", update);
			vertical.removeEventListener("change", update);
			orientation?.removeEventListener("change", update);
		};
	}, [enabled]);
}
