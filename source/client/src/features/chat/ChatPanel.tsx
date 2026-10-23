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
		const panel = element.closest("details");
		const restore = () => {
			if (panel && !panel.open) return;
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
		panel?.addEventListener("toggle", restore);
		return () => panel?.removeEventListener("toggle", restore);
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
}: {
	messages: ChatMessage[];
	colors: readonly string[];
	onSend: (text: string) => Promise<void>;
	onClose?: () => void;
	onFocus?: () => void;
	onBlur?: () => void;
	focusRequest?: number;
}) {
	const [text, setText] = useState(""),
		[error, setError] = useState(""),
		[sending, setSending] = useState(false);
	const panel = useRef<HTMLDetailsElement>(null);
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (focusRequest > 0) {
			if (panel.current) panel.current.open = true;
			input.current?.focus();
		}
	}, [focusRequest]);
	return (
		<details
			ref={panel}
			className="chat-panel"
			aria-label="Room chat"
			open
			onToggle={(event) => {
				if (!event.currentTarget.open) {
					input.current?.blur();
					onClose?.();
				}
			}}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.();
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
			<summary>Chat</summary>
			{messages.length > 0 && (
				<section className="chat-history-box" aria-label="Chat messages">
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
					<button type="submit" disabled={sending || !text.trim()}>
						Send
					</button>
				</form>
				{error && <p role="alert">{error}</p>}
			</section>
		</details>
	);
}
