import { useEffect, useRef, useState } from "react";
import { api } from "../../network/api";
import type { HistoryItem } from "../../network/contracts";
import { duration } from "./format";

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
	useEffect(() => {
		let disposed = false;
		void api<HistoryPage>(`/history?page=0&size=${pageSize}`)
			.then((result) => {
				if (!disposed) {
					setItems(result.items);
					setHasNext(result.hasNext);
				}
			})
			.catch((cause) => {
				if (!disposed)
					setError(
						cause instanceof Error
							? cause.message
							: "History could not be loaded",
					);
			})
			.finally(() => {
				if (!disposed) setLoading(false);
			});
		return () => {
			disposed = true;
			generation.current++;
		};
	}, []);
	const loadMore = async () => {
		if (loading) return;
		setLoading(true);
		setError("");
		const requestGeneration = generation.current;
		try {
			const result = await api<HistoryPage>(
				`/history?page=${page + 1}&size=${pageSize}`,
			);
			if (generation.current !== requestGeneration) return;
			setItems((rows) => [...rows, ...result.items]);
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
	};
	return (
		<section className="history-list" aria-label="Game history">
			{items.map((item) => (
				<button
					type="button"
					key={`${item.kind}:${item.id}`}
					onClick={() => onSelect(item)}
				>
					<span className="kind-label">
						{item.kind}
						{item.room && ` · Map ${item.room.mapLevel}`}
					</span>
					<span>
						{new Date(item.endedAt).toLocaleDateString()} · {item.status}
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
						void loadMore();
					}}
				>
					Load More
				</button>
			)}
			{error && <p role="alert">{error}</p>}
		</section>
	);
}
