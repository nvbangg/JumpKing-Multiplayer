import { PHYSICS } from "../simulation/tuning";
import type { GameMap } from "../simulation/types";
import type { GameRuntime } from "./types";

export function finishMarker(map: GameMap): GameRuntime["finishMarker"] {
	const { finish, tileSize: size, screenHeight: height } = map,
		tiles = map.screens[finish.screen]!.tiles,
		top = -finish.screen * height,
		limit = map.progressOriginY - (finish.minProgress ?? 0) - top,
		firstColumn = Math.ceil(finish.minCenterX / size);
	// Chọn mặt nền thấp nhất đủ điều kiện, ưu tiên đoạn rộng nhất cùng độ cao.
	for (
		let row = Math.min(tiles.length - 1, Math.floor(limit / size));
		row * size >= PHYSICS.bodyHeight / 2;
		row--
	) {
		let start = firstColumn,
			bestStart = 0,
			bestWidth = 0;
		const exposed = (column: number) =>
			column < tiles[row]!.length &&
			"#IN".includes(tiles[row]![column]!) &&
			tiles[row - 1]![column] === " ";
		for (let column = firstColumn; column <= tiles[row]!.length; column++) {
			if (exposed(column)) continue;
			if (column - start > bestWidth) {
				bestStart = start;
				bestWidth = column - start;
			}
			start = column + 1;
		}
		if (bestWidth > 0)
			return {
				screen: finish.screen,
				x: bestStart * size,
				y: top + row * size,
				width: bestWidth * size,
			};
	}
	return undefined;
}
