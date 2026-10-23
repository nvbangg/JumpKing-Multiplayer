import { type RefObject, useLayoutEffect, useState } from "react";

export function useGameWidth(layout: RefObject<HTMLElement | null>) {
	const [gameWidth, setGameWidth] = useState<number>();
	useLayoutEffect(() => {
		let orientation: string | undefined;
		let maximum = Number.POSITIVE_INFINITY;
		const measure = () => {
			const element = layout.current;
			if (!element) return;
			const nextOrientation =
				screen.orientation?.type ||
				(innerWidth > innerHeight ? "landscape" : "portrait");
			// Giữ giới hạn khi F11 tăng cả chiều rộng/chiều cao; xoay thiết bị mới đặt lại.
			if (orientation !== nextOrientation) {
				orientation = nextOrientation;
				maximum = Number.POSITIVE_INFINITY;
			}
			const style = getComputedStyle(element);
			const pixels = (value: string) => Number.parseFloat(value) || 0;
			const availableWidth =
				innerWidth -
				pixels(style.paddingLeft) -
				pixels(style.paddingRight) -
				2 *
					(pixels(style.getPropertyValue("--side-min")) +
						pixels(style.columnGap));
			const availableHeight =
				innerHeight - pixels(style.paddingTop) - pixels(style.paddingBottom);
			const fitted = Math.max(
				1,
				Math.floor(Math.min(960, availableWidth, (availableHeight * 4) / 3)),
			);
			if (!Number.isFinite(maximum)) maximum = fitted;
			setGameWidth(Math.min(maximum, fitted));
		};
		const touch = matchMedia("(pointer: coarse)");
		measure();
		window.addEventListener("resize", measure);
		screen.orientation?.addEventListener("change", measure);
		touch.addEventListener("change", measure);
		return () => {
			window.removeEventListener("resize", measure);
			screen.orientation?.removeEventListener("change", measure);
			touch.removeEventListener("change", measure);
		};
	}, [layout]);
	return gameWidth;
}
