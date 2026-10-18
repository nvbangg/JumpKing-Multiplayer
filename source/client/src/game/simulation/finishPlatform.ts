import { required } from "../../required";
import { PHYSICS } from "./tuning";
import type { GameMap } from "./types";

export interface FinishPlatform {
	screen: number;
	x: number;
	y: number;
	width: number;
}

export function findFinishPlatform(map: GameMap): FinishPlatform | undefined {
	const { finish, tileSize: size, screenHeight: height } = map,
		tiles = required(map.screens[finish.screen]).tiles,
		top = -finish.screen * height,
		limit = map.progressOriginY - (finish.minProgress ?? 0) - top,
		firstColumn = Math.ceil(finish.minCenterX / size),
		exact = (finish.minProgress ?? 0) > 0;
	if (
		firstColumn < 0 ||
		(exact && (limit % size !== 0 || limit < size || limit >= height))
	)
		return undefined;
	// Room ngắn dùng đúng mặt nền cấu hình; đích gốc chỉ cần một dấu chỉ dẫn hợp lệ.
	for (
		let row = Math.min(tiles.length - 1, Math.floor(limit / size));
		row >= (exact ? limit / size : Math.ceil(PHYSICS.bodyHeight / (2 * size)));
		row--
	) {
		let start = firstColumn,
			bestStart = 0,
			bestWidth = 0;
		const floor = required(tiles[row]),
			above = required(tiles[row - 1]);
		const exposed = (column: number) =>
			column < floor.length &&
			"#IN".includes(floor.charAt(column)) &&
			above[column] === " ";
		for (let column = firstColumn; column <= floor.length; column++) {
			if (exposed(column)) continue;
			if (column - start > bestWidth) {
				bestStart = start;
				bestWidth = column - start;
			}
			if (exact) break;
			start = column + 1;
		}
		if (bestWidth > 0)
			return {
				screen: finish.screen,
				x: bestStart * size,
				y: top + row * size,
				width:
					Math.min(
						(bestStart + bestWidth) * size,
						finish.maxCenterX ?? Infinity,
					) -
					bestStart * size,
			};
	}
	return undefined;
}
