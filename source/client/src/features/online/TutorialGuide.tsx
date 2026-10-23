import { useEffect, useState } from "react";
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
		hint: "Release Space to leap! Hold a direction to jump diagonally.",
		touchHint: "Release Jump! Hold a direction to leap diagonally.",
	},
	completed: {
		title: "Ready to Climb!",
		hint: "Great jump! You are ready to conquer the tower.",
		touchHint: "Great jump! You are ready to conquer the tower.",
	},
};

const BASE_STEPS: TutorialStep[] = ["move", "charge", "jump"];

export function TutorialGuide({
	step,
	onDismiss,
}: {
	step: TutorialStep;
	onDismiss: () => void;
}) {
	const [viewStep, setViewStep] = useState<TutorialStep>(step);
	const [hasNavigated, setHasNavigated] = useState(false);

	useEffect(() => {
		setViewStep(step);
		setHasNavigated(false);
	}, [step]);

	useEffect(() => {
		if (step !== "completed" || hasNavigated) return;
		const timer = setTimeout(onDismiss, 4000);
		return () => clearTimeout(timer);
	}, [step, hasNavigated, onDismiss]);

	const visibleSteps =
		step === "completed"
			? [...BASE_STEPS, "completed" as TutorialStep]
			: BASE_STEPS;
	const currentIndex = visibleSteps.indexOf(viewStep);
	const safeIndex = currentIndex === -1 ? 0 : currentIndex;
	const canPrev = safeIndex > 0;
	const canNext = safeIndex < visibleSteps.length - 1;

	const handlePrev = () => {
		if (!canPrev) return;
		const nextStep = visibleSteps[safeIndex - 1];
		if (!nextStep) return;
		setHasNavigated(true);
		setViewStep(nextStep);
	};

	const handleNext = () => {
		if (!canNext) return;
		const nextStep = visibleSteps[safeIndex + 1];
		if (!nextStep) return;
		setHasNavigated(true);
		setViewStep(nextStep);
	};

	const content = STEP_CONTENT[viewStep] ?? STEP_CONTENT[step];

	return (
		<aside className="tutorial-guide" aria-label="Tutorial guide">
			<div className="tutorial-header">
				<div className="tutorial-title-row">
					<button
						type="button"
						className="tutorial-nav-btn"
						onClick={handlePrev}
						disabled={!canPrev}
						aria-label="Previous step"
					>
						‹
					</button>
					<span className="tutorial-title">{content.title}</span>
					<button
						type="button"
						className="tutorial-nav-btn"
						onClick={handleNext}
						disabled={!canNext}
						aria-label="Next step"
					>
						›
					</button>
				</div>
				<button
					type="button"
					className="tutorial-dismiss"
					onClick={onDismiss}
					aria-label={step === "completed" ? "Close tutorial" : "Skip tutorial"}
				>
					{step === "completed" ? "Got it" : "Skip"}
				</button>
			</div>
			<p className="tutorial-hint desktop-only">{content.hint}</p>
			<p className="tutorial-hint touch-only">{content.touchHint}</p>
		</aside>
	);
}
