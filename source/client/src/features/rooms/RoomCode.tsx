import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function RoomCode({ roomId }: { roomId: string }) {
	const [notice, setNotice] = useState("");
	const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const copyRevision = useRef(0);
	const copied = notice === "Copied";
	useEffect(
		() => () => {
			copyRevision.current++;
			if (noticeTimer.current) clearTimeout(noticeTimer.current);
		},
		[],
	);
	return (
		<span className="room-code">
			<button
				type="button"
				className="room-code-copy"
				aria-label="Copy room ID"
				data-copied={copied}
				onClick={async (event) => {
					// Kéo chọn mã thủ công không kích hoạt thao tác sao chép.
					if (event.detail > 0 && window.getSelection()?.isCollapsed === false)
						return;
					const revision = ++copyRevision.current;
					if (noticeTimer.current) clearTimeout(noticeTimer.current);
					setNotice("");
					try {
						await navigator.clipboard.writeText(roomId);
						if (copyRevision.current !== revision) return;
						setNotice("Copied");
						noticeTimer.current = setTimeout(() => setNotice(""), 2000);
					} catch {
						if (copyRevision.current !== revision) return;
						setNotice("Unable to copy. Select the ID to copy.");
					}
				}}
			>
				<code>{roomId}</code>
				{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
			</button>
			<span
				className={copied ? "visually-hidden" : "room-code-status"}
				role="status"
			>
				{notice}
			</span>
		</span>
	);
}
