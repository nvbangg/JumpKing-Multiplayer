import {
	ArrowUpRight,
	BarChart3,
	Box,
	CalendarDays,
	Clock3,
	Flag,
	Gamepad2,
	Map as MapIcon,
	Settings2,
	Skull,
	Timer,
	Trophy,
	Users,
} from "lucide-react";
import ROOM_MAPS from "../../../../common/room-maps.json";
import { DataRow } from "../../components/DataRow";
import type { HistoryItem } from "../../network/contracts";
import { useResource } from "../../network/useResource";
import { displayLabel, duration } from "./format";

interface Participant {
	runId: string;
	username: string;
	status: string;
	rank: number;
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
	const {
		data: detail,
		loading,
		error,
	} = useResource<Detail>(
		`/history/${item.kind}/${encodeURIComponent(item.id)}`,
		item,
	);
	if (loading) return <p role="status">Loading…</p>;
	if (error) return <p role="alert">{error}</p>;
	return (
		<div className="record-body">
			<dl className="record-detail">
				<DataRow label="Type" icon={<Gamepad2 />} tone="tone-cyan">
					{displayLabel(detail.kind)}
				</DataRow>
				<DataRow label="Played At" icon={<CalendarDays />}>
					{new Date(detail.endedAt).toLocaleString(undefined, {
						dateStyle: "medium",
						timeStyle: "short",
					})}
				</DataRow>
				<DataRow
					label="Result"
					icon={<Flag />}
					tone={detail.status === "DNF" ? "tone-red" : "tone-green"}
				>
					{displayLabel(detail.status)}
				</DataRow>
				<DataRow label="Peak" icon={<BarChart3 />}>
					{Math.floor(detail.maxProgress).toLocaleString()} px
				</DataRow>
				<DataRow label="Play Time" icon={<Clock3 />}>
					{duration(detail.playTimeMs)}
				</DataRow>
				<DataRow label="Finish Time" icon={<Trophy />} tone="tone-amber">
					{duration(detail.finishTimeMs)}
				</DataRow>
				<DataRow label="Jumps" icon={<ArrowUpRight />} tone="tone-green">
					{detail.jumps}
				</DataRow>
				<DataRow label="Falls" icon={<Skull />} tone="tone-red">
					{detail.falls}
				</DataRow>
				{detail.room && (
					<>
						<DataRow label="Mode" icon={<Settings2 />}>
							{displayLabel(detail.room.mode)}
						</DataRow>
						<DataRow label="Map" icon={<MapIcon />} tone="tone-cyan">
							{detail.room.mapId} ·{" "}
							{ROOM_MAPS.find((map) => map.level === detail.room?.mapId)?.name}
						</DataRow>
						<DataRow label="Items" icon={<Box />}>
							{detail.room.itemCooldownMinutes == null
								? "Off"
								: `${detail.room.itemCooldownMinutes} min cooldown`}
						</DataRow>
						<DataRow label="Time Limit" icon={<Timer />} tone="tone-amber">
							{detail.timeLimitMinutes == null
								? "Unlimited"
								: `${detail.timeLimitMinutes} min`}
						</DataRow>
						<DataRow label="Rank" icon={<Trophy />} tone="tone-amber">
							{detail.room.rank}
						</DataRow>
						<DataRow label="End" icon={<Flag />}>
							{detail.endReason ? displayLabel(detail.endReason) : "—"}
						</DataRow>
					</>
				)}
			</dl>
			{detail.participants && (
				<section className="participants">
					<h3>
						<Users className="tone-cyan" aria-hidden="true" />
						Participants
					</h3>
					<ol className="leaderboard" aria-label="Match participants">
						{detail.participants.map((player) => (
							<li key={player.runId}>
								<span>
									<span className="rank">{player.rank}.</span> {player.username}
								</span>
								<strong>
									<span className={player.status === "DNF" ? "tone-red" : ""}>
										{displayLabel(player.status)}
									</span>{" "}
									·{" "}
									{player.finishTimeMs === null
										? Math.floor(player.currentProgress).toLocaleString() +
											" px"
										: duration(player.finishTimeMs)}
								</strong>
							</li>
						))}
					</ol>
				</section>
			)}
		</div>
	);
}
