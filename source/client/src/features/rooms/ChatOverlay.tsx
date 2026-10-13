import rules from "../../../../common/rules.json";
import { ChatMessages, ChatPanel } from "../../components/ChatPanel";
import { PRESENTATION } from "../../game/presentation/config";
import type { GameSocket } from "../../network/GameSocket";
import type { useRoomChat } from "./useRoomChat";

export function ChatOverlay({
	chat,
	socket,
}: {
	chat: ReturnType<typeof useRoomChat>;
	socket: GameSocket;
}) {
	if (chat.open)
		return (
			<ChatPanel
				messages={chat.messages}
				colors={rules.appearanceColors}
				focusRequest={chat.focusRequest}
				onSend={async (text) => {
					await socket.command("CHAT_SEND", { text });
				}}
				onClose={chat.closeChat}
			/>
		);
	return chat.preview ? (
		<section className="chat-panel chat-preview" aria-label="New chat messages">
			<ChatMessages
				messages={chat.messages.slice(-PRESENTATION.chatPreviewMessages)}
				colors={rules.appearanceColors}
			/>
		</section>
	) : null;
}
