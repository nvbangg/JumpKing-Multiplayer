import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../network/contracts";
import type { GameSocket } from "../../network/GameSocket";

export interface ChatState {
	open: boolean;
	messages: ChatMessage[];
	focusRequest: number;
	openChat: () => void;
	closeChat: () => void;
}

export function useChat(
	socket: GameSocket,
	enabled = true,
	onOpen?: () => void,
	onClose?: () => void,
): ChatState {
	const [open, setOpen] = useState(false);
	const [focusRequest, setFocusRequest] = useState(0);
	const [messages, setMessages] = useState(() => socket.chatHistory);
	// Listener giữ ổn định; callback luôn đọc trạng thái render mới nhất.
	const opened = useRef(false),
		callbacks = useRef({ enabled, onOpen, onClose });
	callbacks.current = { enabled, onOpen, onClose };
	const openChat = useCallback(() => {
		if (!callbacks.current.enabled) return;
		setFocusRequest((value) => value + 1);
		if (opened.current) return;
		opened.current = true;
		setOpen(true);
		callbacks.current.onOpen?.();
	}, []);
	const closeChat = useCallback(() => {
		if (!opened.current) return;
		opened.current = false;
		setOpen(false);
		callbacks.current.onClose?.();
	}, []);
	useEffect(() => {
		if (!enabled) {
			closeChat();
		}
	}, [enabled, closeChat]);
	useEffect(() => {
		const unsubscribe = socket.subscribe((type) => {
			if (type === "ROOM_JOINED") {
				closeChat();
				setMessages([]);
				return;
			}
			if (type !== "CHAT_MESSAGE" && type !== "CHAT_HISTORY") return;
			setMessages(socket.chatHistory);
		});
		// History có thể tới giữa render và lúc đăng ký listener, nhất là sau reconnect.
		setMessages(socket.chatHistory);
		return unsubscribe;
	}, [socket, closeChat]);
	useEffect(() => {
		const key = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.repeat ||
				event.key !== "Enter" ||
				(event.target instanceof Element &&
					event.target.closest(
						'input,textarea,select,button,a,summary,[contenteditable="true"]',
					))
			)
				return;
			if (callbacks.current.enabled) {
				event.preventDefault();
				openChat();
			}
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [openChat]);
	return { open, messages, focusRequest, openChat, closeChat };
}
