import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TutorialGuide } from "./TutorialGuide";

test("TutorialGuide renders step 1 with disabled prev button and enabled next button", () => {
	const html = renderToStaticMarkup(
		<TutorialGuide step="move" onDismiss={() => {}} />,
	);
	expect(html).toContain("Step 1/3: Move");
	expect(html).toContain("Press A / D or ← / → to walk.");
	expect(html).toMatch(
		/disabled=""[^>]*aria-label="Previous step"|aria-label="Previous step"[^>]*disabled=""/,
	);
	expect(html).toContain('aria-label="Next step"');
	expect(html).not.toMatch(
		/disabled=""[^>]*aria-label="Next step"|aria-label="Next step"[^>]*disabled=""/,
	);
	expect(html).toContain("Skip");
});

test("TutorialGuide renders step 2 with both prev and next buttons enabled", () => {
	const html = renderToStaticMarkup(
		<TutorialGuide step="charge" onDismiss={() => {}} />,
	);
	expect(html).toContain("Step 2/3: Charge");
	expect(html).toContain("Hold Space (or W / ↑) to charge jump.");
	expect(html).not.toMatch(/aria-label="Previous step"[^>]*disabled/);
	expect(html).not.toMatch(/aria-label="Next step"[^>]*disabled/);
});
test("TutorialGuide renders step 3 with prev button enabled and next button disabled", () => {
	const html = renderToStaticMarkup(
		<TutorialGuide step="jump" onDismiss={() => {}} />,
	);
	expect(html).toContain("Step 3/3: Jump");
	expect(html).toContain(
		"Release Space to leap! Hold a direction to jump diagonally.",
	);
	expect(html).not.toMatch(/aria-label="Previous step"[^>]*disabled/);
	expect(html).toMatch(
		/disabled=""[^>]*aria-label="Next step"|aria-label="Next step"[^>]*disabled=""/,
	);
});

test("TutorialGuide renders completed step with Got it and prev button enabled", () => {
	const html = renderToStaticMarkup(
		<TutorialGuide step="completed" onDismiss={() => {}} />,
	);
	expect(html).toContain("Ready to Climb!");
	expect(html).toContain("Great jump! You are ready to conquer the tower.");
	expect(html).not.toMatch(/aria-label="Previous step"[^>]*disabled/);
	expect(html).toMatch(
		/disabled=""[^>]*aria-label="Next step"|aria-label="Next step"[^>]*disabled=""/,
	);
	expect(html).toContain("Got it");
});
