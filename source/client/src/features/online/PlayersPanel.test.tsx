import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { RockIcon } from "./RockIcon";

test("Rock has a dedicated pixel silhouette at the current HUD icon size", () => {
	const html = renderToStaticMarkup(<RockIcon />);
	expect(html).toContain('width="24"');
	expect(html).toContain('height="24"');
	expect(html).toContain('shape-rendering="crispEdges"');
	expect(html).not.toContain("lucide-mountain");
});
