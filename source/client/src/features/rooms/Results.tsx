import { ROOM_MAPS } from "../../game/simulation/roomMaps";
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
			<p>Time: {duration(result.durationMs)}</p>
			<p>
				Map {result.mapId} ·{" "}
				{ROOM_MAPS.find((map) => map.level === result.mapId)?.name}
			</p>
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
								<td>{row.rank}</td>
								<td>
									{row.nickname}
									{row.status === "DNF" ? " · DNF" : ""}
								</td>
								<td>{row.currentProgress.toFixed(1)}</td>
								<td>{duration(row.finishTimeMs)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<button
				type="button"
				disabled={pending || confirmed || result.saveStatus === "PENDING"}
				onClick={onAgain}
			>
				{confirmed
					? "Confirmed for Next Game"
					: result.saveStatus === "FAILED"
						? "Retry Save"
						: "Play Again"}
			</button>
			<button type="button" disabled={pending} onClick={onLeave}>
				Leave
			</button>
			<small role="status">
				{result.saveStatus === "SAVED"
					? "Results saved"
					: result.saveStatus === "PENDING"
						? "Saving results…"
						: "Results could not be saved"}
			</small>
		</>
	);
}
