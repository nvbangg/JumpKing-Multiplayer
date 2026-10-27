import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import type { ReactNode, RefObject } from "react";
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
	const button = (action: TouchAction, label: string, content: ReactNode) => (
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
			{content}
		</button>
	);
	return (
		<section className="touch-controls" aria-label="Touch controls">
			<div>
				{button("left", "Move Left", <ArrowLeft aria-hidden="true" />)}
				{button("right", "Move Right", <ArrowRight aria-hidden="true" />)}
				{flying && (
					<>
						{button("up", "Move Up", <ArrowUp aria-hidden="true" />)}
						{button("down", "Move Down", <ArrowDown aria-hidden="true" />)}
					</>
				)}
			</div>
			{button("jump", "Jump", "Jump")}
		</section>
	);
}
