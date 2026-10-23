import type { RefObject } from "react";
import type {
	InputController,
	TouchAction,
} from "../../game/input/InputController";

export function TouchControls({
	input,
	flying = false,
}: {
	input: RefObject<InputController | null>;
	flying?: boolean;
}) {
	const button = (action: TouchAction, label: string, text: string) => (
		<button
			type="button"
			key={action}
			aria-label={label}
			onContextMenu={(event) => event.preventDefault()}
			onPointerDown={(event) => {
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				input.current?.pressPointer(event.pointerId, action);
			}}
			onPointerUp={(event) => {
				input.current?.releasePointer(event.pointerId);
			}}
			onPointerCancel={(event) => {
				input.current?.cancelPointer(event.pointerId);
			}}
			onLostPointerCapture={(event) => {
				input.current?.cancelPointer(event.pointerId);
			}}
		>
			{text}
		</button>
	);
	return (
		<section className="touch-controls" aria-label="Touch controls">
			<div>
				{button("left", "Move Left", "←")}
				{button("right", "Move Right", "→")}
				{flying && (
					<>
						{button("up", "Move Up", "↑")}
						{button("down", "Move Down", "↓")}
					</>
				)}
			</div>
			{button("jump", "Jump", "Jump")}
		</section>
	);
}
