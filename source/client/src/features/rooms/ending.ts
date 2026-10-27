import type { MatchResult } from "../../network/GameSocket";

/** Room luôn hiển thị Results; ending chỉ có trong Community. */
export function roomFinishScreen(
	_result: MatchResult,
	_selfId: string | null,
	_viewedPlay: string | null,
): "online" | "results" {
	return "results";
}
