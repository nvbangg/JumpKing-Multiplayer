import type { Statistics } from "../../network/contracts";
import { duration } from "./format";

export function StatisticsPanel({ statistics }: { statistics: Statistics }) {
	const rows = [
		["Total Play Time", duration(statistics.totalPlayTimeMs)],
		["Best Finish Time", duration(statistics.bestFinishTimeMs)],
		["Jumps", statistics.totalJumps.toLocaleString()],
		["Falls", statistics.totalFalls.toLocaleString()],
		["Finishes", statistics.finishes.toLocaleString()],
		["Room Wins", statistics.wins.toLocaleString()],
	];
	return (
		<aside className="statistics" aria-label="Total statistics">
			<dl>
				{rows.map(([label, value]) => (
					<div key={label}>
						<dt>{label}</dt>
						<dd>{value}</dd>
					</div>
				))}
			</dl>
		</aside>
	);
}
