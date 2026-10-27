import { MessageCircle, Send } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NETWORK } from "../../network/config";
import type { ChatMessage } from "../../network/contracts";

export function ChatMessages({
	messages,
	colors,
}: {
	messages: ChatMessage[];
	colors: readonly string[];
}) {
	const list = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	const anchor = useRef<{ id: string; offset: number } | null>(null);
	const [away, setAway] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Khôi phục vị trí đọc sau khi danh sách tin thay đổi.
	useLayoutEffect(() => {
		const element = list.current;
		if (!element) return;
		const restore = () => {
			if (follow.current) element.scrollTop = element.scrollHeight;
			else if (anchor.current) {
				const saved = anchor.current;
				const message = Array.from(element.children).find(
					(child) => (child as HTMLElement).dataset.messageId === saved.id,
				);
				element.scrollTop = message
					? element.scrollTop +
						message.getBoundingClientRect().top -
						element.getBoundingClientRect().top -
						saved.offset
					: 0;
			}
		};
		restore();
	}, [messages]);
	return (
		<>
			<div
				ref={list}
				className="chat-messages"
				role="log"
				aria-label="Messages"
				aria-live="polite"
				onScroll={(event) => {
					const element = event.currentTarget;
					follow.current =
						element.scrollHeight - element.clientHeight - element.scrollTop <=
						24;
					setAway(!follow.current);
					const top = element.getBoundingClientRect().top;
					const first = Array.from(element.children).find(
						(child) => child.getBoundingClientRect().bottom > top,
					);
					anchor.current = first
						? {
								id: (first as HTMLElement).dataset.messageId || "",
								offset: first.getBoundingClientRect().top - top,
							}
						: null;
				}}
			>
				{messages.map((message) => (
					<p key={message.id} data-message-id={message.id}>
						<strong style={{ color: colors[message.colorSlot] || "#ffffff" }}>
							{message.nickname}:{" "}
						</strong>
						{message.text}
					</p>
				))}
			</div>
			{away && (
				<button
					className="chat-latest"
					type="button"
					onClick={() => {
						follow.current = true;
						setAway(false);
						if (list.current)
							list.current.scrollTop = list.current.scrollHeight;
					}}
				>
					Latest
				</button>
			)}
		</>
	);
}
export function ChatPanel({
	messages,
	colors,
	onSend,
	onClose,
	onFocus,
	onBlur,
	focusRequest = 0,
	autoHide = true,
}: {
	messages: ChatMessage[];
	colors: readonly string[];
	onSend: (text: string) => Promise<void>;
	onClose?: () => void;
	onFocus?: () => void;
	onBlur?: () => void;
	focusRequest?: number;
	autoHide?: boolean;
}) {
	const [text, setText] = useState(""),
		[error, setError] = useState(""),
		[sending, setSending] = useState(false);
	const [historyVisible, setHistoryVisible] = useState(true);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const hovered = useRef(false);
	const clearTimer = () => {
		clearTimeout(timer.current);
	};
	const hideLater = (delay: number) => {
		clearTimer();
		if (autoHide && !hovered.current)
			timer.current = setTimeout(() => setHistoryVisible(false), delay);
	};
	const latestMessage = messages.at(-1)?.id;
	// biome-ignore lint/correctness/useExhaustiveDependencies: Chỉ tin nhắn mới khởi động lại thời gian hiện lịch sử.
	useEffect(() => {
		setHistoryVisible(true);
		clearTimeout(timer.current);
		if (autoHide && !hovered.current)
			timer.current = setTimeout(() => setHistoryVisible(false), 5000);
		return () => clearTimeout(timer.current);
	}, [latestMessage, autoHide]);
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (focusRequest > 0) {
			input.current?.focus();
		}
	}, [focusRequest]);
	return (
		<section
			className="chat-panel"
			aria-label="Room chat"
			onFocus={() => {
				setHistoryVisible(true);
				hideLater(5000);
			}}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) {
					hideLater(2000);
					onBlur?.();
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					if (event.target instanceof HTMLElement) event.target.blur();
					onClose?.();
				}
			}}
		>
			{!autoHide && (
				<h3 className="chat-title">
					<MessageCircle className="tone-cyan" aria-hidden="true" />
					Chat
				</h3>
			)}
			{autoHide && messages.length > 0 && (
				<button
					className="chat-history-toggle"
					type="button"
					aria-label="Show chat history"
					aria-expanded={historyVisible}
					onClick={() => {
						setHistoryVisible(true);
						hideLater(5000);
					}}
				>
					<MessageCircle className="tone-cyan" aria-hidden="true" />
					Chat
				</button>
			)}
			{messages.length > 0 && (
				<section
					className="chat-history-box"
					aria-label="Chat messages"
					aria-hidden={!historyVisible}
					data-hidden={!historyVisible}
					onPointerEnter={() => {
						hovered.current = true;
						clearTimer();
						setHistoryVisible(true);
					}}
					onPointerLeave={() => {
						hovered.current = false;
						hideLater(2000);
					}}
				>
					<ChatMessages messages={messages} colors={colors} />
				</section>
			)}
			<section className="chat-input-box" aria-label="Chat input">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (sending || !text.trim()) return;
						if ([...text].length > NETWORK.maxChatCodePoints) {
							setError(
								"Messages can contain up to " +
									NETWORK.maxChatCodePoints +
									" characters",
							);
							return;
						}
						const sentText = text;
						setSending(true);
						setError("");
						input.current?.focus();
						void onSend(sentText)
							.then(() => {
								// ACK chậm không được xóa draft mới hoặc giành lại focus sau Escape.
								setText((current) => (current === sentText ? "" : current));
							})
							.catch((cause) =>
								setError(
									cause instanceof Error
										? cause.message
										: "Message could not be sent",
								),
							)
							.finally(() => setSending(false));
					}}
				>
					<label className="visually-hidden" htmlFor="chat-message">
						Message
					</label>
					<input
						ref={input}
						id="chat-message"
						value={text}
						placeholder="Enter to chat"
						onFocus={onFocus}
						onChange={(event) => setText(event.currentTarget.value)}
						autoComplete="off"
					/>
					<button
						className="icon-button"
						type="submit"
						aria-label="Send"
						disabled={sending || !text.trim()}
					>
						<Send aria-hidden="true" />
					</button>
				</form>
				{error && <p role="alert">{error}</p>}
			</section>
		</section>
	);
}
