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

test("jump instructions combine charging and direction without hiding the earlier controls", () => {
	const html = renderToStaticMarkup(
		<TutorialGuide step="jump" onDismiss={() => {}} />,
	);
	expect(html).toContain("Hold Space / W / ↑");
	expect(html).toContain("A / D or ← / →");
	expect(html).toContain("release while holding an arrow");
});
