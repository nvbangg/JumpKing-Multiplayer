import rules from "../../../../common/rules.json";
import { ChatPanel } from "../../components/ChatPanel";
import { PRESENTATION } from "../../game/presentation/config";
import type { GameSocket } from "../../network/GameSocket";
import type { RoomChatState } from "./useRoomChat";

export function ChatOverlay({
	chat,
	socket,
}: {
	chat: RoomChatState;
	socket: GameSocket;
}) {
	return (
		<ChatPanel
			messages={chat.messages}
			colors={rules.appearanceColors}
			messageLimit={PRESENTATION.chatVisibleMessages}
			focusRequest={chat.focusRequest}
			onSend={async (text) => {
				await socket.command("CHAT_SEND", { text });
			}}
			onFocus={chat.openChat}
			onBlur={chat.closeChat}
			onClose={chat.closeChat}
		/>
	);
}
