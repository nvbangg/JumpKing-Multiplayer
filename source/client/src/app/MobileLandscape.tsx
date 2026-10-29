import { Maximize, RotateCw, Smartphone } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { requestLandscape, useMobileDisplay } from "./useMobileDisplay";
import { useMobilePortrait } from "./useMobilePortrait";

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
	return (
		<>
			<div className="app-content" inert={portrait}>
				{children}
			</div>
			{!fullscreen && (
				<button
					aria-label="Enter full screen"
					className="fullscreen-toggle"
					onClick={(event) => {
						event.stopPropagation();
						void requestLandscape();
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
