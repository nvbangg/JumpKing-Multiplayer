import type { ReactNode, RefObject } from "react";
import type {
	InputController,
	TouchAction,
} from "../../game/input/InputController";

function Arrow({ rotation = 0 }: { rotation?: number }) {
	return (
		<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M19 12H5m7-7-7 7 7 7"
				transform={`rotate(${rotation} 12 12)`}
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

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
				{button("left", "Move Left", <Arrow />)}
				{button("right", "Move Right", <Arrow rotation={180} />)}
				{flying && (
					<>
						{button("up", "Move Up", <Arrow rotation={90} />)}
						{button("down", "Move Down", <Arrow rotation={270} />)}
					</>
				)}
			</div>
			{button("jump", "Jump", "Jump")}
		</section>
	);
}
