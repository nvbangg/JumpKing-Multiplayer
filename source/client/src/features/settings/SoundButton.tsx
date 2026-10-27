import { Volume2, VolumeX } from "lucide-react";
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
			className="sound-switch"
			aria-label={`Sound: ${options.sound ? "On" : "Off"}`}
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
			<span>
				{options.sound ? (
					<Volume2 aria-hidden="true" />
				) : (
					<VolumeX aria-hidden="true" />
				)}
				Sound
			</span>
			<span className="switch-track" aria-hidden="true">
				<span />
			</span>
		</button>
	);
}
