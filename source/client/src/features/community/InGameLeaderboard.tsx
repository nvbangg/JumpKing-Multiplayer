import { PRESENTATION } from "../../game/presentation/config";
import type { LeaderboardEntry } from "../../network/contracts";
import { useResource } from "../../network/useResource";
import { duration } from "../records/format";
export function InGameLeaderboard() {
	const { data, loading, error, reload } = useResource<{
		entries: LeaderboardEntry[];
	}>(`/leaderboard?limit=${PRESENTATION.inGameLeaderboardLimit}`, {
		entries: [],
	});
	const entries = data.entries;
	return (
		<section
			className="in-game-panel records-panel"
			aria-label="Community leaderboard"
		>
			<h2>Leaderboard</h2>
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
			<button type="button" disabled={loading} onClick={reload}>
				Refresh
			</button>
		</section>
	);
}
