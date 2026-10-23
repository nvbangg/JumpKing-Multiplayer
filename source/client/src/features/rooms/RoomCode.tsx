import { useState } from "react";

export function RoomCode({ roomId }: { roomId: string }) {
	const [copied, setCopied] = useState<string | null>(null);
	const [error, setError] = useState("");
	return (
		<span className="room-code">
			<span className="room-code-label">Room ID</span>
			<output aria-label="Room ID">
				<code>{roomId}</code>
			</output>
			<button
				type="button"
				onClick={() => {
					setError("");
					if (!navigator.clipboard) {
						setError("Select the room ID to copy.");
						return;
					}
					void navigator.clipboard
						.writeText(roomId)
						.then(() => setCopied(roomId))
						.catch(() => setError("Select the room ID to copy."));
				}}
			>
				{copied === roomId ? "Copied" : "Copy ID"}
			</button>
			{error && <small role="status">{error}</small>}
		</span>
	);
}
