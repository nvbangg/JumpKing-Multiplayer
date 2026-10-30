import rules from "../../../../common/rules.json";
import { InputController } from "../../game/input/InputController";
import { PRESENTATION } from "../../game/presentation/config";

// AFK theo tương tác trên trang; mất focus chỉ nhả input, không Pause.
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
	const activity = () => {
		lastActivity = performance.now();
	};
	const input = new InputController(activity, pause, cancel, jump);
	const interactions = [
		"pointermove",
		"pointerdown",
		"pointerup",
		"keydown",
		"wheel",
	] as const;
	for (const event of interactions)
		window.addEventListener(event, activity, { capture: true, passive: true });
	const afk = window.setInterval(() => {
		if (pauseWhenIdle() && performance.now() - lastActivity >= rules.afkMs)
			pause();
	}, PRESENTATION.afkPollMs);
	const release = () => {
		input.release();
		cancel();
	};
	const hidden = () => {
		if (document.hidden) release();
	};
	document.addEventListener("visibilitychange", hidden);
	window.addEventListener("blur", release);
	return {
		input,
		dispose() {
			clearInterval(afk);
			input.dispose();
			for (const event of interactions)
				window.removeEventListener(event, activity, true);
			document.removeEventListener("visibilitychange", hidden);
			window.removeEventListener("blur", release);
		},
	};
}
