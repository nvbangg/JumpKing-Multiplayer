import { useCallback, useEffect, useRef, useState } from "react";
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
}: {
	onSelect: (item: HistoryItem) => void;
}) {
	const [items, setItems] = useState<HistoryItem[]>([]);
	const [page, setPage] = useState(0),
		[hasNext, setHasNext] = useState(false),
		[loading, setLoading] = useState(true),
		[error, setError] = useState("");
	const generation = useRef(0);
	const pageSize = 20;
	const loadPage = useCallback(async (nextPage: number) => {
		setLoading(true);
		setError("");
		const requestGeneration = generation.current;
		try {
			const result = await api<HistoryPage>(
				`/history?page=${nextPage}&size=${pageSize}`,
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
			{items.map((item) => (
				<button
					type="button"
					key={`${item.kind}:${item.id}`}
					onClick={() => onSelect(item)}
				>
					<span className="kind-label">
						{displayLabel(item.kind)}
						{item.room && ` · Map ${item.room.mapLevel}`}
					</span>
					<span>
						{new Date(item.endedAt).toLocaleString(undefined, {
							dateStyle: "short",
							timeStyle: "short",
						})}{" "}
						· {displayLabel(item.status)}
					</span>
					<span>{duration(item.finishTimeMs ?? item.playTimeMs)}</span>
				</button>
			))}
			{loading && <p role="status">Loading…</p>}
			{!loading && !items.length && !error && <p>No completed games.</p>}
			{hasNext && (
				<button
					type="button"
					disabled={loading}
					onClick={() => {
						void loadPage(page + 1);
					}}
				>
					Load More
				</button>
			)}
			{error && <p role="alert">{error}</p>}
		</section>
	);
}
