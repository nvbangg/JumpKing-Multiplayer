import { useEffect, useState } from "react";
import rules from "../../../../common/rules.json";
import { ChatPanel } from "../../components/ChatPanel";
import type { GameSocket } from "../../network/GameSocket";
export function RoomChat({ socket }: { socket: GameSocket }) {
	const [messages, setMessages] = useState(() => socket.chatHistory);
	useEffect(() => {
		const unsubscribe = socket.subscribe((type) => {
			if (type === "CHAT_MESSAGE" || type === "CHAT_HISTORY")
				setMessages(socket.chatHistory);
		});
		setMessages(socket.chatHistory);
		return unsubscribe;
	}, [socket]);
	return (
		<ChatPanel
			messages={messages}
			colors={rules.appearanceColors}
			onSend={async (text) => {
				await socket.command("CHAT_SEND", { text });
			}}
		/>
	);
}
