import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { App } from "./App";

test("entry renders an accessible page without a backend connection", () => {
	const html = renderToStaticMarkup(<App />);
	expect(html).toContain('alt="JumpKing"');
	expect(html).toContain("New Solo Game");
	expect(html).toContain("Total Play Time");
});
