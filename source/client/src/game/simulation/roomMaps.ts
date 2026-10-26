import goals from "../../../../common/room-maps.json";
import { findFinishPlatform } from "./finishPlatform";
import { PHYSICS } from "./tuning";
import type { GameMap } from "./types";

export const ROOM_MAPS = goals;
export function roomMap(map: GameMap, level: number): GameMap {
	const index = ROOM_MAPS.findIndex((item) => item.level === level),
		goal = ROOM_MAPS[index];
	if (!goal) throw new Error("Invalid Room map level");
	if (level === 1) return { ...map, finish: goal.finish };

	const previous = ROOM_MAPS[index - 1];
	if (!previous) throw new Error("Room map is missing its previous Finish");
	const platform = findFinishPlatform({ ...map, finish: previous.finish });
	if (!platform || platform.width <= 0)
		throw new Error("Room Finish cannot provide a safe next-map spawn");
	const spawn = {
		x: platform.x + (platform.width - PHYSICS.bodyWidth) / 2,
		y: platform.y - PHYSICS.bodyHeight,
	};
	// Giữ tọa độ thế giới, nhưng tiến độ của chặng mới bắt đầu từ 0.
	const progressOriginY = spawn.y + PHYSICS.bodyHeight;
	return {
		...map,
		spawn,
		progressOriginY,
		roomBottomY: spawn.y,
		finish: {
			...goal.finish,
			minProgress: goal.finish.minProgress
				? goal.finish.minProgress + progressOriginY - map.progressOriginY
				: 0,
		},
	};
}
