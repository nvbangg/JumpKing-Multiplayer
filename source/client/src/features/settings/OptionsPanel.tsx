import { useEffect, useState } from "react";
import type { Options } from "./options";

export function OptionsButtons({
	options,
	onChange,
	onError,
}: {
	options: Options;
	onChange: (key: keyof Options) => void;
	onError: (message: string) => void;
}) {
	const [fullscreen, setFullscreen] = useState(
		() => !!document.fullscreenElement,
	);
	useEffect(() => {
		const changed = () => setFullscreen(!!document.fullscreenElement);
		document.addEventListener("fullscreenchange", changed);
		return () => document.removeEventListener("fullscreenchange", changed);
	}, []);
	return (
		<>
			<button
				type="button"
				role="switch"
				aria-checked={options.sound}
				onClick={() => onChange("sound")}
			>
				Sound: {options.sound ? "On" : "Off"}
			</button>
			<button
				type="button"
				role="switch"
				aria-checked={fullscreen}
				disabled={
					typeof document !== "undefined" && !document.fullscreenEnabled
				}
				onClick={() => {
					const action = document.fullscreenElement
						? document.exitFullscreen()
						: document.documentElement.requestFullscreen();
					void action.catch(() =>
						onError("Fullscreen is unavailable in this browser"),
					);
				}}
			>
				Fullscreen: {fullscreen ? "On" : "Off"}
			</button>
		</>
	);
}
