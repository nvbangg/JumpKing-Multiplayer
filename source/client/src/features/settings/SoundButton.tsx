import type { Options } from "./options";

export function SoundButton({
	options,
	onChange,
	onError,
}: {
	options: Options;
	onChange: (key: keyof Options) => void;
	onError: (message: string) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={options.sound}
			onClick={() => {
				try {
					onChange("sound");
					onError("");
				} catch {
					onError("Sound preference could not be saved on this device");
				}
			}}
		>
			Sound: {options.sound ? "On" : "Off"}
		</button>
	);
}
