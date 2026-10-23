export function duration(ms: number | null): string {
	if (ms === null) return "—";
	const seconds = Math.floor(ms / 1000),
		minutes = Math.floor(seconds / 60),
		hours = Math.floor(minutes / 60);
	return `${hours ? `${hours}:` : ""}${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function displayLabel(value: string): string {
	if (value === "DNF") return value;
	return value
		.toLowerCase()
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}
