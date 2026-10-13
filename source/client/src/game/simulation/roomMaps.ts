import goals from "../../../../common/room-maps.json";
import type { GameMap } from "./types";

export const ROOM_MAPS = goals;
export function roomMap(map: GameMap, level: number): GameMap {
	const goal = ROOM_MAPS.find((item) => item.level === level);
	if (!goal) throw new Error("Invalid Room map level");
	return { ...map, finish: goal.finish };
}
