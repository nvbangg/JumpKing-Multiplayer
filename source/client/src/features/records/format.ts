export function duration(ms: number | null): string {
	if (ms === null) return "—";
	const seconds = Math.floor(ms / 1000),
		minutes = Math.floor(seconds / 60),
		hours = Math.floor(minutes / 60);
	return `${hours ? hours + ":" : ""}${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
