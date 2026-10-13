import type { Options } from "./options";

export function OptionsButtons({
	options,
	flyAllowed,
	onChange,
	onError,
}: {
	options: Options;
	flyAllowed: boolean;
	onChange: (key: keyof Options) => void;
	onError: (message: string) => void;
}) {
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
				Fullscreen
			</button>
			{flyAllowed && (
				<button
					type="button"
					role="switch"
					aria-checked={options.fly}
					onClick={() => onChange("fly")}
				>
					Fly Mode: {options.fly ? "On" : "Off"}
				</button>
			)}
		</>
	);
}
