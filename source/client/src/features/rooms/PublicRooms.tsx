import { LogIn, RefreshCw, Users } from "lucide-react";
import ROOM_MAPS from "../../../../common/room-maps.json";
import { useResource } from "../../network/useResource";
import { displayLabel } from "../records/format";

interface PublicRoom {
	roomId: string;
	mode: string;
	mapId: number;
	itemCooldownMinutes: number | null;
	timeLimitMinutes: number | null;
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
	return (
		<>
			<div className="list-toolbar">
				<p className="muted">Choose a room to join</p>
				<button
					type="button"
					className="icon-button"
					aria-label="Refresh"
					disabled={loading || pending}
					onClick={reload}
				>
					<RefreshCw className={loading ? "spinning" : ""} aria-hidden="true" />
				</button>
			</div>
			{loading && <p role="status">Loading…</p>}
			{error && <p role="alert">{error}</p>}
			{!loading && !error && !data.rooms.length && (
				<div className="empty-state">
					<Users aria-hidden="true" />
					<p>No public rooms available.</p>
				</div>
			)}
			{data.rooms.length > 0 && (
				<div className="table-scroll">
					<table className="public-rooms" aria-label="Public rooms">
						<thead>
							<tr>
								<th>Room Code</th>
								<th>Mode</th>
								<th>Map</th>
								<th>Items</th>
								<th>Time Limit</th>
								<th>Players</th>
								<th>
									<span className="visually-hidden">Join</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{data.rooms.map((room) => (
								<tr key={room.roomId}>
									<td data-label="Room">
										<code>{room.roomId}</code>
									</td>
									<td data-label="Mode">{displayLabel(room.mode)}</td>
									<td data-label="Map">
										{room.mapId} ·{" "}
										{ROOM_MAPS.find((map) => map.level === room.mapId)?.name}
									</td>
									<td data-label="Items">
										{room.itemCooldownMinutes == null
											? "Off"
											: `${room.itemCooldownMinutes} min cooldown`}
									</td>
									<td data-label="Time Limit">
										{room.timeLimitMinutes == null
											? "Unlimited"
											: `${room.timeLimitMinutes} min`}
									</td>
									<td data-label="Players">
										{room.playerCount} / {room.capacity}
									</td>
									<td>
										<button
											className="button-primary"
											type="button"
											aria-label={`Join ${room.roomId}`}
											disabled={loading || pending}
											onClick={() => onJoin(room.roomId)}
										>
											<LogIn aria-hidden="true" />
											Join
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</>
	);
}
