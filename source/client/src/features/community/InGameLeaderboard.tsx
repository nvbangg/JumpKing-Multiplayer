import { useEffect, useState } from "react";
import { PRESENTATION } from "../../game/presentation/config";
import { api } from "../../network/api";
import type { LeaderboardEntry } from "../../network/contracts";
import { duration } from "../records/format";
export function InGameLeaderboard() {
	const [revision, setRevision] = useState(0),
		[entries, setEntries] = useState<LeaderboardEntry[]>([]),
		[loading, setLoading] = useState(true),
		[error, setError] = useState("");
	// biome-ignore lint/correctness/useExhaustiveDependencies: Revision là tín hiệu tải lại khi nhấn Refresh.
	useEffect(() => {
		let active = true;
		setLoading(true);
		setError("");
		void api<{ entries: LeaderboardEntry[] }>(
			`/leaderboard?limit=${PRESENTATION.inGameLeaderboardLimit}`,
		)
			.then((result) => {
				if (active) setEntries(result.entries);
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
			<button
				type="button"
				disabled={loading}
				onClick={() => setRevision((value) => value + 1)}
			>
				Refresh
			</button>
		</section>
	);
}
