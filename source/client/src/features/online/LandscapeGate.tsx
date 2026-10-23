import { useEffect, useRef, useState } from "react";

type LockableOrientation = ScreenOrientation & {
	lock?: (orientation: "landscape") => Promise<void>;
};

export function LandscapeGate({ onPortrait }: { onPortrait: () => void }) {
	const [portrait, setPortrait] = useState(false);
	const [pending, setPending] = useState(false);
	const gate = useRef<HTMLDivElement>(null);
	const pause = useRef(onPortrait);
	pause.current = onPortrait;
	const ownedLock = useRef(false);
	const ownedFullscreen = useRef(false);
	const mounted = useRef(false);
	const orientation = screen.orientation as LockableOrientation | undefined;
	const canLock = Boolean(
		orientation?.lock && document.documentElement.requestFullscreen,
	);

	useEffect(() => {
		const orientation = screen.orientation as LockableOrientation | undefined;
		mounted.current = true;
		const touch = matchMedia("(pointer: coarse)");
		const vertical = matchMedia("(orientation: portrait)");
		let wasPortrait = false;
		const update = () => {
			// Bàn phím ảo có thể đổi tỷ lệ viewport, nhưng không đổi hướng thiết bị.
			const isPortrait =
				touch.matches &&
				(orientation?.type
					? orientation.type.startsWith("portrait")
					: vertical.matches);
			setPortrait(isPortrait);
			if (isPortrait && !wasPortrait) pause.current();
			wasPortrait = isPortrait;
		};
		update();
		touch.addEventListener("change", update);
		vertical.addEventListener("change", update);
		orientation?.addEventListener("change", update);
		if (touch.matches && orientation?.lock) {
			void orientation
				.lock("landscape")
				.then(() => {
					if (mounted.current) ownedLock.current = true;
					else orientation.unlock();
				})
				.catch(() => {
					// Trình duyệt có thể yêu cầu thao tác người dùng hoặc xoay thủ công.
				});
		}
		return () => {
			mounted.current = false;
			touch.removeEventListener("change", update);
			vertical.removeEventListener("change", update);
			orientation?.removeEventListener("change", update);
			if (ownedLock.current) orientation?.unlock();
			if (ownedFullscreen.current && document.fullscreenElement) {
				void document.exitFullscreen().catch(() => {});
			}
		};
	}, []);

	useEffect(() => {
		if (!portrait) return;
		const previous = document.activeElement;
		const keepFocus = () => {
			if (!gate.current?.contains(document.activeElement))
				gate.current?.focus({ preventScroll: true });
		};
		keepFocus();
		document.addEventListener("focusin", keepFocus);
		return () => {
			document.removeEventListener("focusin", keepFocus);
			if (previous instanceof HTMLElement && previous.isConnected)
				previous.focus({ preventScroll: true });
		};
	}, [portrait]);

	async function rotate() {
		if (!orientation?.lock) return;
		setPending(true);
		try {
			if (!document.fullscreenElement) {
				await document.documentElement.requestFullscreen();
				ownedFullscreen.current = true;
			}
			if (!mounted.current) {
				if (ownedFullscreen.current && document.fullscreenElement)
					await document.exitFullscreen();
				return;
			}
			await orientation.lock("landscape");
			if (mounted.current) ownedLock.current = true;
			else orientation.unlock();
		} catch {
			// Giữ hướng dẫn xoay máy khi thiết bị không cho phép khóa hướng.
		} finally {
			if (mounted.current) setPending(false);
		}
	}

	if (!portrait) return null;
	return (
		<div
			ref={gate}
			tabIndex={-1}
			className="landscape-gate"
			role="dialog"
			aria-modal="true"
			aria-label="Landscape required"
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Tab") {
					event.preventDefault();
					(
						gate.current?.querySelector<HTMLButtonElement>(
							"button:not(:disabled)",
						) || gate.current
					)?.focus();
				} else if (event.target === gate.current) {
					event.preventDefault();
				}
			}}
			onKeyUp={(event) => event.stopPropagation()}
		>
			<p>Rotate your device to play.</p>
			{canLock && (
				<button type="button" disabled={pending} onClick={() => void rotate()}>
					Rotate Screen
				</button>
			)}
		</div>
	);
}
