import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TutorialGuide } from "./TutorialGuide";

test.each(["move", "charge", "jump", "completed"] as const)(
	"tutorial shows the current %s step without manual navigation",
	(step) => {
		const html = renderToStaticMarkup(
			<TutorialGuide step={step} onDismiss={() => {}} />,
		);
		expect(html).not.toContain("Previous step");
		expect(html).not.toContain("Next step");
		expect(html).toContain(step === "completed" ? "Got it" : "Skip");
		expect(html).toContain(step === "completed" ? "Ready to Climb!" : "Step");
	},
);
