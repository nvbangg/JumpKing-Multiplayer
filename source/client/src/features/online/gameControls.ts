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
		if (
			!document.hidden &&
			document.hasFocus() &&
			pauseWhenIdle() &&
			performance.now() - lastActivity >= rules.afkMs
		) {
			pause();
		}
	}, PRESENTATION.afkPollMs);

	const releaseInput = () => {
		input.releaseAll();
		lastActivity = performance.now();
	};

	const hidden = () => {
		if (document.hidden) releaseInput();
	};

	const focused = () => {
		lastActivity = performance.now();
	};

	document.addEventListener("visibilitychange", hidden);
	window.addEventListener("blur", releaseInput);
	window.addEventListener("focus", focused);

	return {
		input,
		dispose() {
			clearInterval(afk);
			input.dispose();
			document.removeEventListener("visibilitychange", hidden);
			window.removeEventListener("blur", releaseInput);
			window.removeEventListener("focus", focused);
		},
	};
}
