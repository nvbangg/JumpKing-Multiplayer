import { Maximize, RotateCw, Smartphone } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useMobileDisplay } from "./useMobileDisplay";
import { useMobilePortrait } from "./useMobilePortrait";

type LockableOrientation = ScreenOrientation & {
	lock?: (orientation: "landscape") => Promise<void>;
};

export function MobileLandscape({ children }: { children: ReactNode }) {
	useMobileDisplay();
	const portrait = useMobilePortrait();
	const notice = useRef<HTMLDivElement>(null);
	const [fullscreen, setFullscreen] = useState(
		() => document.fullscreenElement !== null,
	);
	useEffect(() => {
		const updateFullscreen = () =>
			setFullscreen(document.fullscreenElement !== null);
		document.addEventListener("fullscreenchange", updateFullscreen);
		updateFullscreen();
		return () =>
			document.removeEventListener("fullscreenchange", updateFullscreen);
	}, []);
	useEffect(() => {
		if (!portrait) return;
		const previous = document.activeElement;
		notice.current?.focus({ preventScroll: true });
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected)
				previous.focus({ preventScroll: true });
		};
	}, [portrait]);
	const requestLandscape = async () => {
		try {
			if (!document.fullscreenElement)
				await document.documentElement.requestFullscreen?.({
					navigationUI: "hide",
				});
		} catch {
			// Thử khóa hướng dù browser từ chối fullscreen.
		}
		try {
			await (screen.orientation as LockableOrientation | undefined)?.lock?.(
				"landscape",
			);
		} catch {
			// Nếu không hỗ trợ, người chơi có thể xoay thiết bị thủ công.
		}
	};
	return (
		<>
			<div className="app-content" inert={portrait}>
				{children}
			</div>
			{!fullscreen && (
				<button
					aria-label="Enter full screen"
					className="fullscreen-toggle"
					onClick={() => {
						void document.documentElement.requestFullscreen?.().catch(() => {});
					}}
					title="Enter full screen"
					type="button"
				>
					<Maximize aria-hidden="true" />
				</button>
			)}
			{portrait && (
				<div
					ref={notice}
					className="landscape-gate"
					role="dialog"
					aria-modal="true"
					aria-labelledby="landscape-title"
					aria-describedby="landscape-description"
					tabIndex={-1}
				>
					<Smartphone aria-hidden="true" />
					<h1 id="landscape-title">Landscape required</h1>
					<p id="landscape-description">
						Turn your phone sideways to continue.
					</p>
					<button
						className="button button-primary"
						onClick={(event) => {
							event.stopPropagation();
							void requestLandscape();
						}}
						type="button"
					>
						<RotateCw aria-hidden="true" />
						Try landscape
					</button>
				</div>
			)}
		</>
	);
}
