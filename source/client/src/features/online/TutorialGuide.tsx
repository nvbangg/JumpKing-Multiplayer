import type { TutorialStep } from "./tutorial";

const STEP_CONTENT: Record<
	TutorialStep,
	{ title: string; hint: string; touchHint: string }
> = {
	move: {
		title: "Step 1/3: Move",
		hint: "Press A / D or ← / → to walk.",
		touchHint: "Tap the arrow buttons to walk.",
	},
	charge: {
		title: "Step 2/3: Charge",
		hint: "Hold Space (or W / ↑) to charge jump.",
		touchHint: "Hold the Jump button to charge.",
	},
	jump: {
		title: "Step 3/3: Jump",
		hint: "Hold Space / W / ↑, then release while holding A / D or ← / → to jump sideways.",
		touchHint:
			"Hold Jump, then release while holding an arrow to jump sideways.",
	},
};

export function TutorialGuide({
	step,
	onDismiss,
}: {
	step: TutorialStep;
	onDismiss: () => void;
}) {
	const content = STEP_CONTENT[step];

	return (
		<aside className="tutorial-guide" aria-label="Tutorial guide">
			<div className="tutorial-header">
				<span className="tutorial-title">{content.title}</span>
				<button
					type="button"
					className="tutorial-dismiss"
					onClick={onDismiss}
					aria-label="Skip tutorial"
				>
					Skip
				</button>
			</div>
			<p className="tutorial-hint desktop-only">{content.hint}</p>
			<p className="tutorial-hint touch-only">{content.touchHint}</p>
		</aside>
	);
}
