import rules from "../../../../common/rules.json";
import { InputController } from "../../game/input/InputController";
import { PRESENTATION } from "../../game/presentation/config";

// Cùng vòng đời cho input, mất focus và AFK; dispose hủy toàn bộ listener/timer.
export function createGameControls({
	pause,
	cancel,
	jump,
	pauseWhenIdle,
}: {
	pause: () => void;
	cancel: () => void;
	jump: (now: number) => void;
	pauseWhenIdle: () => boolean;
}) {
	let lastActivity = performance.now();
	const input = new InputController(
		() => {
			lastActivity = performance.now();
		},
		pause,
		cancel,
		jump,
	);
	const afk = window.setInterval(() => {
		if (pauseWhenIdle() && performance.now() - lastActivity >= rules.afkMs)
			pause();
	}, PRESENTATION.afkPollMs);
	const hidden = () => {
		if (document.hidden) pause();
	};
	document.addEventListener("visibilitychange", hidden);
	window.addEventListener("blur", pause);
	return {
		input,
		dispose() {
			clearInterval(afk);
			input.dispose();
			document.removeEventListener("visibilitychange", hidden);
			window.removeEventListener("blur", pause);
		},
	};
}
