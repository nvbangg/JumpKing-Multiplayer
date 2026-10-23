import { useEffect, useState } from "react";
import { api } from "./api";

export function useResource<T>(path: string, initial: T) {
	const [data, setData] = useState(initial);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [revision, setRevision] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Revision chỉ dùng để Refresh thủ công.
	useEffect(() => {
		let active = true;
		setLoading(true);
		setError("");
		void api<T>(path)
			.then((value) => {
				if (active) setData(value);
			})
			.catch((cause) => {
				if (active)
					setError(
						cause instanceof Error ? cause.message : "Unable to load data",
					);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [path, revision]);
	return {
		data,
		loading,
		error,
		reload: () => setRevision((value) => value + 1),
	};
}
