import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatPanel } from "../../src/features/chat/ChatPanel";
import { required } from "../../src/required";

export function mountChatPanel() {
	const parent = document.createElement("div");
	parent.style.cssText = "position:fixed;inset:0;z-index:100;background:black";
	document.body.append(parent);
	const acknowledgements: (() => void)[] = [];
	let requestFocus = () => {};
	function Panel() {
		const [focusRequest, setFocusRequest] = useState(0);
		requestFocus = () => setFocusRequest((value) => value + 1);
		return (
			<ChatPanel
				messages={[]}
				colors={[]}
				focusRequest={focusRequest}
				onSend={() =>
					new Promise<void>((resolve) => acknowledgements.push(resolve))
				}
				onClose={() => {
					parent.dataset.closed = "true";
				}}
			/>
		);
	}
	createRoot(parent).render(<Panel />);
	return {
		acknowledgeChat: () => acknowledgements.shift()?.(),
		focusChat: () => requestFocus(),
	};
}

export function mountChatHistory() {
	const parent = document.createElement("div");
	parent.style.cssText = "position:fixed;inset:0;z-index:100;background:black";
	document.body.append(parent);
	let append = () => {};
	function History() {
		const [messages, setMessages] = useState(
			Array.from({ length: 30 }, (_, i) => ({
				id: String(i),
				playerId: "self",
				nickname: "Player",
				text: `Message ${i}`,
				sentAt: "2026-01-01T00:00:00Z",
				colorSlot: 0,
			})),
		);
		append = () =>
			setMessages((rows) => {
				const last = Number(rows.at(-1)?.id) + 1;
				return [
					...rows.slice(1),
					{ ...required(rows[0]), id: String(last), text: `Message ${last}` },
				];
			});
		return (
			<ChatPanel messages={messages} colors={[]} onSend={async () => {}} />
		);
	}
	createRoot(parent).render(<History />);
	return () => append();
}
