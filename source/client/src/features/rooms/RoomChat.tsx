import rules from "../../../../common/rules.json";
import { ChatPanel } from "../../components/ChatPanel";
import type { GameSocket } from "../../network/GameSocket";
import { useRoomChat } from "./useRoomChat";
export function RoomChat({ socket }: { socket: GameSocket }) {
	const chat = useRoomChat(socket);
	return (
		<ChatPanel
			messages={chat.messages}
			colors={rules.appearanceColors}
			focusRequest={chat.focusRequest}
			onSend={async (text) => {
				await socket.command("CHAT_SEND", { text });
			}}
		/>
	);
}
