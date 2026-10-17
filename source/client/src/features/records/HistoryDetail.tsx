import { useEffect, useState } from "react";
import { ROOM_MAPS } from "../../game/simulation/roomMaps";
import { api } from "../../network/api";
import type { HistoryItem } from "../../network/contracts";
import { duration } from "./format";

interface Participant {
	runId: string;
	nickname: string;
	status: string;
	rank: number;
	isWinner: boolean;
	currentProgress: number;
	maxProgress: number;
	finishTimeMs: number | null;
	playTimeMs: number;
	jumps: number;
	falls: number;
}
interface Detail extends HistoryItem {
	endReason?: string;
	timeLimitMinutes?: number | null;
	participants?: Participant[];
}
export function HistoryDetail({ item }: { item: HistoryItem }) {
	const [detail, setDetail] = useState<Detail>(item),
		[loading, setLoading] = useState(true),
		[error, setError] = useState("");
	useEffect(() => {
		let disposed = false;
		void api<Detail>(
			"/history/" + item.kind + "/" + encodeURIComponent(item.id),
		)
			.then((value) => {
				if (!disposed) setDetail(value);
			})
			.catch((cause) => {
				if (!disposed)
					setError(
						cause instanceof Error
							? cause.message
							: "Game details could not be loaded",
					);
			})
			.finally(() => {
				if (!disposed) setLoading(false);
			});
		return () => {
			disposed = true;
		};
	}, [item.kind, item.id]);
	if (loading) return <p role="status">Loading…</p>;
	if (error) return <p role="alert">{error}</p>;
	return (
		<>
			<dl className="record-detail">
				<dt>Type</dt>
				<dd>{detail.kind}</dd>
				<dt>Result</dt>
				<dd>{detail.status}</dd>
				<dt>Play Time</dt>
				<dd>{duration(detail.playTimeMs)}</dd>
				<dt>Finish Time</dt>
				<dd>{duration(detail.finishTimeMs)}</dd>
				<dt>Jumps</dt>
				<dd>{detail.jumps}</dd>
				<dt>Falls</dt>
				<dd>{detail.falls}</dd>
				<dt>Peak</dt>
				<dd>{Math.floor(detail.maxProgress)} px</dd>
				{detail.room && (
					<>
						<dt>Room</dt>
						<dd>{detail.room.roomCode}</dd>
						<dt>Mode</dt>
						<dd>{detail.room.mode}</dd>
						<dt>Map</dt>
						<dd>
							{detail.room.mapLevel} ·{" "}
							{
								ROOM_MAPS.find((map) => map.level === detail.room?.mapLevel)
									?.name
							}
						</dd>
						<dt>Rank</dt>
						<dd>{detail.room.rank}</dd>
						<dt>End</dt>
						<dd>{detail.endReason}</dd>
					</>
				)}
			</dl>
			{detail.participants && (
				<ol className="leaderboard" aria-label="Match participants">
					{detail.participants.map((player) => (
						<li key={player.runId}>
							<span>
								{player.rank}. {player.nickname}
								{player.isWinner ? " · Winner" : ""}
							</span>
							<strong>
								{player.status} ·{" "}
								{player.finishTimeMs === null
									? Math.floor(player.currentProgress) + " px"
									: duration(player.finishTimeMs)}
							</strong>
						</li>
					))}
				</ol>
			)}
		</>
	);
}
