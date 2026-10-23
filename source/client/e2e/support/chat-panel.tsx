import { createRoot } from "react-dom/client";
import { ChatPanel } from "../../src/features/chat/ChatPanel";

export function mountChatPanel() {
	const parent = document.createElement("div");
	parent.style.cssText = "position:fixed;inset:0;z-index:100;background:black";
	document.body.append(parent);
	const acknowledgements: (() => void)[] = [];
	createRoot(parent).render(
		<ChatPanel
			messages={[]}
			colors={[]}
			onSend={() =>
				new Promise<void>((resolve) => acknowledgements.push(resolve))
			}
			onClose={() => {
				parent.dataset.closed = "true";
			}}
		/>,
	);
	return () => acknowledgements.shift()?.();
}
