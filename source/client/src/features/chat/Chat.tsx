import rules from "../../../../common/rules.json";
import type { GameSocket } from "../../network/GameSocket";
import { ChatPanel } from "./ChatPanel";
import { type ChatState, useChat } from "./useChat";

export function LobbyChat({ socket }: { socket: GameSocket }) {
	const chat = useChat(socket);
	return <Chat chat={chat} socket={socket} />;
}

export function Chat({
	chat,
	socket,
	dismissible = false,
}: {
	chat: ChatState;
	socket: GameSocket;
	dismissible?: boolean;
}) {
	return (
		<ChatPanel
			messages={chat.messages}
			colors={rules.appearanceColors}
			focusRequest={chat.focusRequest}
			onSend={async (text) => {
				await socket.command("CHAT_SEND", { text });
			}}
			onFocus={dismissible ? chat.openChat : undefined}
			onBlur={dismissible ? chat.closeChat : undefined}
			onClose={dismissible ? chat.closeChat : undefined}
		/>
	);
}
