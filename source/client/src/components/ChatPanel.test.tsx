import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ChatPanel } from "./ChatPanel";

const messages = Array.from({ length: 12 }, (_, index) => ({
	id: String(index),
	playerId: "player",
	nickname: "Player",
	text: `message-${index}`,
	sentAt: "2026-01-01T00:00:00Z",
	colorSlot: 0,
}));

test("Lobby keeps its full chat history", () => {
	const html = renderToStaticMarkup(
		<ChatPanel
			messages={messages}
			colors={["#ffffff"]}
			onSend={async () => {}}
		/>,
	);
	expect(html.match(/<p>/g)).toHaveLength(12);
	expect(html).toContain("message-0");
});

test("an in-game limit keeps only the latest messages", () => {
	const html = renderToStaticMarkup(
		<ChatPanel
			messages={messages}
			colors={["#ffffff"]}
			messageLimit={10}
			onSend={async () => {}}
		/>,
	);
	expect(html.match(/<p>/g)).toHaveLength(10);
	expect(html).not.toContain("message-0");
	expect(html).toContain("message-11");
});
