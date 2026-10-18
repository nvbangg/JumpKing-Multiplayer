import { useEffect, useMemo, useRef, useState } from "react";
import { NETWORK } from "../network/config";
import type { ChatMessage } from "../network/contracts";

export function ChatMessages({
	messages,
	colors,
}: {
	messages: ChatMessage[];
	colors: readonly string[];
}) {
	const list = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Tin nhắn đổi cần cuộn DOM đã render xuống cuối.
	useEffect(() => {
		if (list.current) list.current.scrollTop = list.current.scrollHeight;
	}, [messages]);
	return (
		<div
			ref={list}
			className="chat-messages"
			role="log"
			aria-label="Messages"
			aria-live="polite"
		>
			{messages.map((message) => (
				<p key={message.id}>
					<strong style={{ color: colors[message.colorSlot] || "#ffffff" }}>
						{message.nickname}:{" "}
					</strong>
					{message.text}
				</p>
			))}
		</div>
	);
}
export function ChatPanel({
	messages,
	colors,
	onSend,
	onClose,
	onFocus,
	onBlur,
	messageLimit,
	focusRequest = 0,
}: {
	messages: ChatMessage[];
	colors: readonly string[];
	onSend: (text: string) => Promise<void>;
	onClose?: () => void;
	onFocus?: () => void;
	onBlur?: () => void;
	messageLimit?: number;
	focusRequest?: number;
}) {
	const [text, setText] = useState(""),
		[error, setError] = useState(""),
		[sending, setSending] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const displayMessages = useMemo(
		() =>
			messageLimit === undefined ? messages : messages.slice(-messageLimit),
		[messages, messageLimit],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Mỗi focusRequest yêu cầu focus lại cùng ô nhập.
	useEffect(() => {
		if (focusRequest > 0) input.current?.focus();
	}, [focusRequest]);
	return (
		<section
			className="chat-panel"
			aria-label="Room chat"
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
			{displayMessages.length > 0 && (
				<section className="chat-history-box" aria-label="Chat messages">
					<ChatMessages messages={displayMessages} colors={colors} />
				</section>
			)}
			<section className="chat-input-box" aria-label="Chat input">
				<header>
					<span>Chat</span>
					{onClose && (
						<button
							type="button"
							onClick={(event) => {
								event.currentTarget.blur();
								onClose();
							}}
							aria-label="Close chat"
						>
							×
						</button>
					)}
				</header>
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
						setSending(true);
						setError("");
						void onSend(text)
							.then(() => {
								setText("");
								if (onClose) {
									input.current?.form
										?.querySelector<HTMLElement>(":focus")
										?.blur();
									onClose();
								} else input.current?.focus();
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
		</section>
	);
}
