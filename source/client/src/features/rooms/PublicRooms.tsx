import { useEffect, useState } from "react";
import { api } from "../../network/api";
import { displayLabel } from "../records/format";

interface PublicRoom {
	roomId: string;
	mode: string;
	mapLevel: number;
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
	const [rooms, setRooms] = useState<PublicRoom[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [revision, setRevision] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Revision là tín hiệu của nút Refresh.
	useEffect(() => {
		let active = true;
		setLoading(true);
		setError("");
		void api<{ rooms: PublicRoom[] }>("/rooms")
			.then((result) => {
				if (active) setRooms(result.rooms);
			})
			.catch((cause) => {
				if (active) setError(cause.message);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [revision]);
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
							{room.roomId} · {displayLabel(room.mode)} · Map {room.mapLevel} ·{" "}
							{room.playerCount}/{room.capacity}
						</button>
					</li>
				))}
			</ul>
			<button
				type="button"
				disabled={loading || pending}
				onClick={() => setRevision((value) => value + 1)}
			>
				Refresh
			</button>
		</>
	);
}
