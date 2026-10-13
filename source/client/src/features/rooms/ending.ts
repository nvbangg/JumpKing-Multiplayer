import type { MatchResult } from "../../network/GameSocket";

/** Chờ commit trước ending; lỗi lưu vẫn cho người thắng retry từ Results. */
export function roomFinishScreen(
	result: MatchResult,
	selfId: string | null,
	viewedPlay: string | null,
): "online" | "results" {
	return (result.mapLevel ?? 10) === 10 &&
		result.reason === "FINISH" &&
		result.saveStatus !== "FAILED" &&
		result.playId !== viewedPlay &&
		result.results.some(
			(row) =>
				row.playerId === selfId && row.status === "FINISHED" && row.isWinner,
		)
		? "online"
		: "results";
}
