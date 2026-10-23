import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ChatPanel } from "./ChatPanel";

test("chat displays player names and messages as plain text", () => {
	const html = renderToStaticMarkup(
		<ChatPanel
			messages={[
				{
					id: "message",
					playerId: "player",
					nickname: "<Player>",
					text: "<script>alert(1)</script>",
					sentAt: "2026-01-01T00:00:00Z",
					colorSlot: 0,
				},
			]}
			colors={["#ffffff"]}
			onSend={async () => {}}
		/>,
	);
	expect(html).toContain("&lt;Player&gt;");
	expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
	expect(html).not.toContain("<script>");
});
