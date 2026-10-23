import { expect, test } from "vitest";
import type { MatchResult } from "../../network/GameSocket";
import { roomFinishScreen } from "./ending";

const result: MatchResult = {
	mapLevel: 10,
	playId: "match",
	reason: "FINISH",
	durationMs: 1000,
	saveStatus: "PENDING",
	results: [
		{
			playerId: "winner",
			nickname: "King",
			status: "FINISHED",
			rank: 1,
			currentProgress: 100,
			maxProgress: 100,
			isWinner: true,
			finishTimeMs: 1000,
		},
		{
			playerId: "peer",
			nickname: "Peer",
			status: "UNFINISHED",
			rank: 2,
			currentProgress: 10,
			maxProgress: 20,
			isWinner: false,
			finishTimeMs: null,
		},
	],
};
test("only a finishing winner waits for the committed ending and can return to Results", () => {
	expect(roomFinishScreen(result, "winner", null)).toBe("online");
	expect(
		roomFinishScreen({ ...result, saveStatus: "SAVED" }, "winner", null),
	).toBe("online");
	expect(roomFinishScreen(result, "peer", null)).toBe("results");
	expect(roomFinishScreen(result, null, null)).toBe("results");
	expect(roomFinishScreen(result, "winner", "match")).toBe("results");
	expect(
		roomFinishScreen({ ...result, reason: "TIME_LIMIT" }, "winner", null),
	).toBe("results");
	expect(
		roomFinishScreen({ ...result, saveStatus: "FAILED" }, "winner", null),
	).toBe("results");
	for (let mapLevel = 1; mapLevel < 10; mapLevel++)
		expect(roomFinishScreen({ ...result, mapLevel }, "winner", null)).toBe(
			"results",
		);
	expect(roomFinishScreen({ ...result, mapLevel: 10 }, "winner", null)).toBe(
		"online",
	);
});
