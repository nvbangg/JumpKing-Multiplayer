export function RoomCode({ roomId }: { roomId: string }) {
	return (
		<span className="room-code">
			<span className="room-code-label">Room ID</span>
			<output aria-label="Room ID">
				<code>{roomId}</code>
			</output>
		</span>
	);
}
