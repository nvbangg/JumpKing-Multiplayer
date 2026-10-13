import { useCallback, useEffect, useRef, useState } from "react";
import { PRESENTATION } from "../../game/presentation/config";
import type { GameSocket } from "../../network/GameSocket";

export function useRoomChat(
	socket: GameSocket,
	enabled = true,
	onOpen?: () => void,
	onClose?: () => void,
) {
	const [open, setOpen] = useState(false),
		[preview, setPreview] = useState(false);
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
		setPreview(false);
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
			setPreview(false);
		}
	}, [enabled, closeChat]);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined,
			lastId = socket.chatHistory.at(-1)?.id;
		const unsubscribe = socket.subscribe((type) => {
			if (type === "ROOM_JOINED") {
				closeChat();
				setMessages([]);
				setPreview(false);
				clearTimeout(timer);
				lastId = undefined;
				return;
			}
			if (type !== "CHAT_MESSAGE" && type !== "CHAT_HISTORY") return;
			const rows = socket.chatHistory,
				id = rows.at(-1)?.id;
			setMessages(rows);
			if (
				type === "CHAT_MESSAGE" &&
				id &&
				id !== lastId &&
				!opened.current &&
				callbacks.current.enabled
			) {
				setPreview(true);
				clearTimeout(timer);
				timer = setTimeout(() => setPreview(false), PRESENTATION.chatPreviewMs);
			}
			lastId = id;
		});
		// History có thể tới giữa render và lúc đăng ký listener, nhất là sau reconnect.
		setMessages(socket.chatHistory);
		lastId = socket.chatHistory.at(-1)?.id;
		return () => {
			unsubscribe();
			clearTimeout(timer);
		};
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
	return { open, preview, messages, focusRequest, openChat, closeChat };
}
