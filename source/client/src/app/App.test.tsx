import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { App } from "./App";

test("entry renders an accessible page without a backend connection", () => {
	const html = renderToStaticMarkup(<App />);
	expect(html).toContain('alt="JumpKing"');
	expect(html).toContain("New Game");
	expect(html).toContain("Create Room");
	expect(html).toContain("Join Public Room");
	expect(html).toContain('aria-label="Room ID"');
	expect(html).toContain('inputMode="numeric"');
	expect(html).toContain('pattern="[0-9]{6}"');
	expect(html).not.toContain(">Room<");
	expect(html).not.toContain(">History<");
	expect(html).not.toContain("Hold Space");
	expect(html).not.toContain("Sound: On");
	expect(html).not.toContain(">Options<");
	expect(html).not.toContain("Fullscreen");
	expect(html).not.toContain("Chat Online");
});

test("history screen keeps brand logo above the menu panel", () => {
	globalThis.location = { pathname: "/history" } as unknown as Location;
	try {
		const html = renderToStaticMarkup(<App />);
		expect(html).toContain("screen-history");
		expect(html).toContain('alt="JumpKing"');
	} finally {
		Reflect.deleteProperty(globalThis, "location");
	}
});
