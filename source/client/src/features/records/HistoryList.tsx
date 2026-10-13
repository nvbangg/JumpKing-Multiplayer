import { useEffect, useRef, useState } from "react";
import { api } from "../../network/api";
import type { HistoryItem } from "../../network/contracts";
import { type SoloRun, soloRuns } from "../solo/storage";
import { duration, soloHistory } from "./format";

interface HistoryPage {
	items: HistoryItem[];
	page: number;
	hasNext: boolean;
}
export function HistoryList({
	profile,
	authenticated,
	hasIdentity,
	revision,
	onSelect,
}: {
	profile: string;
	authenticated: boolean;
	hasIdentity: boolean;
	revision: number;
	onSelect: (item: HistoryItem, local: boolean) => void;
}) {
	const [local, setLocal] = useState<HistoryItem[]>([]),
		[remote, setRemote] = useState<HistoryItem[]>([]);
	const [pendingIds, setPendingIds] = useState(new Set<string>());
	const [page, setPage] = useState(0),
		[hasNext, setHasNext] = useState(false),
		[loading, setLoading] = useState(true),
		[error, setError] = useState("");
	const generation = useRef(0);
	const pageSize = 20;
	// biome-ignore lint/correctness/useExhaustiveDependencies: Revision báo server/local history đã đổi và cần tải lại.
	useEffect(() => {
		let disposed = false;
		generation.current++;
		setLoading(true);
		setError("");
		setPage(0);
		setRemote([]);
		setHasNext(false);
		void (async () => {
			let runs: SoloRun[] = [];
			try {
				runs = await soloRuns(profile);
			} catch (cause) {
				if (!disposed)
					setError(
						cause instanceof Error
							? cause.message
							: "Browser storage is unavailable",
					);
			}
			if (disposed) return;
			const unsynced = new Set(
				runs
					.filter((run) => run.revision > run.syncedRevision)
					.map((run) => run.id),
			);
			setPendingIds(authenticated ? unsynced : new Set());
			setLocal(
				soloHistory(runs).filter(
					(item) => !authenticated || unsynced.has(item.id),
				),
			);
			if (hasIdentity) {
				try {
					const result = await api<HistoryPage>(
						"/history?page=0&size=" + pageSize,
					);
					if (!disposed) {
						setRemote(result.items);
						setHasNext(result.hasNext);
					}
				} catch (cause) {
					if (!disposed) setLocal(soloHistory(runs));
					throw cause;
				}
			}
		})()
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
	}, [profile, authenticated, hasIdentity, revision]);
	const loadMore = async () => {
		if (loading) return;
		setLoading(true);
		setError("");
		const requestGeneration = generation.current;
		try {
			const result = await api<HistoryPage>(
				"/history?page=" + (page + 1) + "&size=" + pageSize,
			);
			if (generation.current !== requestGeneration) return;
			setRemote((rows) => [...rows, ...result.items]);
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
	const merged = new Map(
		local.map((item) => [item.kind + ":" + item.id, item]),
	);
	for (const item of remote) merged.set(item.kind + ":" + item.id, item);
	const items = [...merged.values()].sort(
		(a, b) =>
			b.endedAt.localeCompare(a.endedAt) ||
			a.kind.localeCompare(b.kind) ||
			b.id.localeCompare(a.id),
	);
	return (
		<section className="history-list" aria-label="Game history">
			{items.map((item) => (
				<button
					type="button"
					key={item.kind + ":" + item.id}
					onClick={() =>
						onSelect(
							item,
							item.kind === "SOLO" &&
								!remote.some(
									(row) => row.kind === item.kind && row.id === item.id,
								),
						)
					}
				>
					<span className="kind-label">
						{item.kind}
						{item.room && ` · Map ${item.room.mapLevel}`}
					</span>
					<span>
						{new Date(item.endedAt).toLocaleDateString()} · {item.status}
						{pendingIds.has(item.id) && item.kind === "SOLO"
							? " · Pending sync"
							: ""}
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
