import {
	CircleCheck,
	Clock3,
	LogOut,
	Map as MapIcon,
	Play,
} from "lucide-react";
import ROOM_MAPS from "../../../../common/room-maps.json";
import type { MatchResult, RoomState } from "../../network/GameSocket";
import { duration } from "../records/format";

export function Results({
	result,
	room,
	selfId,
	pending,
	onAgain,
	onLeave,
}: {
	result: MatchResult;
	room: RoomState | null;
	selfId: string | null;
	pending: boolean;
	onAgain: () => void;
	onLeave: () => void;
}) {
	const confirmed =
		room?.members.find((member) => member.playerId === selfId)
			?.nextMatchConfirmed === true;
	return (
		<>
			<small
				className="save-status"
				data-status={result.saveStatus}
				role="status"
			>
				{result.saveStatus === "SAVED" && <CircleCheck aria-hidden="true" />}
				{result.saveStatus === "SAVED"
					? "Results saved"
					: result.saveStatus === "PENDING"
						? "Saving results…"
						: "Results could not be saved"}
			</small>
			<div className="result-overview">
				<span>
					<MapIcon className="tone-cyan" aria-hidden="true" />
					Map {result.mapId} ·{" "}
					{ROOM_MAPS.find((map) => map.level === result.mapId)?.name}
				</span>
				<span>
					<Clock3 aria-hidden="true" />
					Time: {duration(result.durationMs)}
				</span>
			</div>
			<div className="results-table">
				<table>
					<thead>
						<tr>
							<th>Rank</th>
							<th>Player</th>
							<th>Height</th>
							<th>Finish Time</th>
						</tr>
					</thead>
					<tbody>
						{result.results.map((row) => (
							<tr
								key={row.playerId}
								className={row.playerId === selfId ? "self-result" : undefined}
							>
								<td data-label="Rank">{row.rank}</td>
								<td data-label="Player">
									{row.nickname}
									{row.status === "DNF" ? " · DNF" : ""}
								</td>
								<td data-label="Height">{row.currentProgress.toFixed(1)}</td>
								<td data-label="Finish Time">{duration(row.finishTimeMs)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<footer className="panel-actions">
				<button
					type="button"
					className="button-primary"
					disabled={pending || confirmed || result.saveStatus === "PENDING"}
					onClick={onAgain}
				>
					<Play aria-hidden="true" />
					{confirmed
						? "Confirmed for Next Game"
						: result.saveStatus === "FAILED"
							? "Retry Save"
							: "Play Again"}
				</button>
				<button
					type="button"
					className="button-danger"
					disabled={pending}
					onClick={onLeave}
				>
					<LogOut aria-hidden="true" />
					Leave
				</button>
			</footer>
		</>
	);
}
