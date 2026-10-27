import { expect, test } from "vitest";
import type { MatchResult } from "../../network/GameSocket";
import { roomFinishScreen } from "./ending";

const result: MatchResult = {
	mapId: 8,
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
			finishTimeMs: 1000,
		},
		{
			playerId: "peer",
			nickname: "Peer",
			status: "UNFINISHED",
			rank: 2,
			currentProgress: 10,
			maxProgress: 20,
			finishTimeMs: null,
		},
	],
};
test("Room map finishes always go to Results without playing an ending", () => {
	for (let mapId = 1; mapId <= 8; mapId++)
		expect(roomFinishScreen({ ...result, mapId }, "winner", null)).toBe(
			"results",
		);
	expect(roomFinishScreen(result, "winner", "match")).toBe("results");
});
