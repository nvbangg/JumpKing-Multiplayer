import { ArrowUpRight, Clock3, Crown, Flag, Skull, Trophy } from "lucide-react";
import { DataRow } from "../../components/DataRow";
import type { Statistics } from "../../network/contracts";
import { duration } from "./format";

export function StatisticsPanel({ statistics }: { statistics: Statistics }) {
	const rows = [
		{
			label: "Total Play Time",
			value: duration(statistics.totalPlayTimeMs),
			icon: <Clock3 />,
			tone: "tone-blue",
		},
		{
			label: "Best Finish Time",
			value: duration(statistics.bestFinishTimeMs),
			icon: <Trophy />,
			tone: "tone-amber",
		},
		{
			label: "Finishes",
			value: statistics.finishes.toLocaleString(),
			icon: <Crown />,
			tone: "tone-amber",
		},
		{
			label: "Room Wins",
			value: (statistics.roomWins ?? 0).toLocaleString(),
			icon: <Flag />,
			tone: "tone-purple",
		},
		{
			label: "Jumps",
			value: statistics.totalJumps.toLocaleString(),
			icon: <ArrowUpRight />,
			tone: "tone-green",
		},
		{
			label: "Falls",
			value: statistics.totalFalls.toLocaleString(),
			icon: <Skull />,
			tone: "tone-red",
		},
	];
	return (
		<aside className="statistics" aria-label="Total statistics">
			<dl>
				{rows.map(({ label, value, icon, tone }) => (
					<DataRow key={label} label={label} icon={icon} tone={tone}>
						{value}
					</DataRow>
				))}
			</dl>
		</aside>
	);
}
