import { Trophy } from "lucide-react";
import { PRESENTATION } from "../../game/presentation/config";
import type { LeaderboardEntry } from "../../network/contracts";
import { useResource } from "../../network/useResource";
import { duration } from "../records/format";

export function InGameLeaderboard({ onRefresh }: { onRefresh: () => void }) {
	const { data, loading, error, reload } = useResource<{
		entries: LeaderboardEntry[];
	}>(`/leaderboard?limit=${PRESENTATION.inGameLeaderboardLimit}`, {
		entries: [],
	});
	const entries = data.entries;
	return (
		<details
			open
			className="in-game-panel records-panel"
			aria-label="Community leaderboard"
		>
			<summary>
				<h2>
					<Trophy className="tone-amber" aria-hidden="true" />
					Leaderboard
				</h2>
			</summary>
			<ol aria-label="Community records">
				{entries.map((entry) => (
					<li key={entry.id}>
						<span>
							{entry.rank}. {entry.username}
						</span>
						<strong>
							{entry.finishTimeMs === null
								? `${Math.floor(entry.maxProgress)} px`
								: duration(entry.finishTimeMs)}
						</strong>
					</li>
				))}
			</ol>
			{loading && <p role="status">Loading…</p>}
			{error && <p role="alert">{error}</p>}
			{!loading && !error && !entries.length && <p>No records yet.</p>}
			<button
				type="button"
				disabled={loading}
				onClick={() => {
					reload();
					onRefresh();
				}}
			>
				Refresh
			</button>
		</details>
	);
}
