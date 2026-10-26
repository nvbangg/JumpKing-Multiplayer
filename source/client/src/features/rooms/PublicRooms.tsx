import { useResource } from "../../network/useResource";
import { displayLabel } from "../records/format";

interface PublicRoom {
	roomId: string;
	mode: string;
	mapId: number;
	playerCount: number;
	capacity: number;
}

export function PublicRooms({
	onJoin,
	pending,
}: {
	onJoin: (roomId: string) => void;
	pending: boolean;
}) {
	const { data, loading, error, reload } = useResource<{ rooms: PublicRoom[] }>(
		"/rooms",
		{ rooms: [] },
	);
	const rooms = data.rooms;
	return (
		<>
			{loading && <p role="status">Loading…</p>}
			{error && <p role="alert">{error}</p>}
			{!loading && !error && !rooms.length && <p>No public rooms available.</p>}
			<ul className="public-rooms" aria-label="Public rooms">
				{rooms.map((room) => (
					<li key={room.roomId}>
						<button
							type="button"
							disabled={loading || pending}
							onClick={() => onJoin(room.roomId)}
						>
							{room.roomId} · {displayLabel(room.mode)} · Map {room.mapId} ·{" "}
							{room.playerCount}/{room.capacity}
						</button>
					</li>
				))}
			</ul>
			<button type="button" disabled={loading || pending} onClick={reload}>
				Refresh
			</button>
		</>
	);
}
