import { ChevronRight, Gamepad2, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ROOM_MAPS from "../../../../common/room-maps.json";
import { BackButton } from "../../components/BackButton";
import { api } from "../../network/api";
import type { HistoryItem } from "../../network/contracts";
import { displayLabel, duration } from "./format";

interface HistoryPage {
	items: HistoryItem[];
	page: number;
	hasNext: boolean;
}
export function HistoryList({
	onSelect,
	onBack,
}: {
	onSelect: (item: HistoryItem) => void;
	onBack?: () => void;
}) {
	const [items, setItems] = useState<HistoryItem[]>([]);
	const [page, setPage] = useState(0),
		[hasNext, setHasNext] = useState(false),
		[loading, setLoading] = useState(true),
		[error, setError] = useState("");
	const generation = useRef(0);
	const loadPage = useCallback(async (nextPage: number) => {
		setLoading(true);
		setError("");
		const requestGeneration = generation.current;
		try {
			const result = await api<HistoryPage>(
				`/history?page=${nextPage}&size=20`,
			);
			if (generation.current !== requestGeneration) return;
			setItems((rows) =>
				nextPage === 0 ? result.items : [...rows, ...result.items],
			);
			setPage(result.page);
			setHasNext(result.hasNext);
		} catch (cause) {
			if (generation.current === requestGeneration)
				setError(
					cause instanceof Error
						? cause.message
						: "History could not be loaded",
				);
		} finally {
			if (generation.current === requestGeneration) setLoading(false);
		}
	}, []);
	useEffect(() => {
		void loadPage(0);
		return () => {
			generation.current++;
		};
	}, [loadPage]);
	return (
		<section className="history-list" aria-label="Game history">
			<div className="history-heading" aria-hidden="true">
				<span>Type</span>
				<span>Played At</span>
				<span>Result</span>
				<span>Map</span>
				<span>Play Time</span>
				<span />
			</div>
			<div className="history-rows">
				{items.map((item) => (
					<button
						type="button"
						key={`${item.kind}:${item.id}`}
						onClick={() => onSelect(item)}
					>
						<span className="history-kind">
							{item.kind === "COMMUNITY" ? (
								<Users className="tone-cyan" aria-hidden="true" />
							) : (
								<Gamepad2 className="tone-amber" aria-hidden="true" />
							)}
							{displayLabel(item.kind)}
						</span>
						<time className="history-date" dateTime={item.endedAt}>
							{new Date(item.endedAt).toLocaleString(undefined, {
								dateStyle: "medium",
								timeStyle: "short",
							})}
						</time>
						<span
							className={
								"history-status " +
								(item.status === "FINISHED"
									? "tone-green"
									: item.status === "DNF"
										? "tone-red"
										: "")
							}
						>
							{displayLabel(item.status)}
						</span>
						<span className="history-map">
							{item.room
								? item.room.mapId +
									" · " +
									(ROOM_MAPS.find((map) => map.level === item.room?.mapId)
										?.name || "Map")
								: "Main Babe"}
						</span>
						<span className="history-time">
							{duration(item.finishTimeMs ?? item.playTimeMs)}
						</span>
						<ChevronRight className="history-chevron" aria-hidden="true" />
					</button>
				))}
			</div>
			{loading && <p role="status">Loading…</p>}
			{!loading && !items.length && !error && (
				<p className="empty-state">No completed games.</p>
			)}
			{error && <p role="alert">{error}</p>}
			<footer className="panel-actions">
				{hasNext && (
					<button
						type="button"
						disabled={loading}
						onClick={() => void loadPage(page + 1)}
					>
						Load More
					</button>
				)}
				{onBack && <BackButton onClick={onBack} />}
			</footer>
		</section>
	);
}
