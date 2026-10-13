import type { GameMap } from "./types";

export function parseMap(value: unknown): GameMap {
	if (!value || typeof value !== "object") throw new Error("Invalid map");
	const map = value as GameMap;
	if (
		map.width !== 480 ||
		map.screenHeight !== 360 ||
		map.tileSize !== 8 ||
		map.progressOriginY !== 328 ||
		map.spawn?.x !== 231 ||
		map.spawn?.y !== 302 ||
		map.finish?.screen !== 42 ||
		map.finish?.minCenterX !== 336 ||
		map.finish?.requiresGrounded !== true ||
		!Array.isArray(map.screens) ||
		map.screens.length !== 43
	)
		throw new Error("Invalid Main Babe map contract");
	for (const screen of map.screens) {
		if (
			!Array.isArray(screen.tiles) ||
			screen.tiles.length !== 45 ||
			typeof screen.wind !== "boolean" ||
			screen.tiles.some(
				(row) =>
					typeof row !== "string" ||
					row.length !== 60 ||
					/[^ #INabcd]/.test(row),
			)
		)
			throw new Error("Invalid tile geometry");
		if (Object.keys(screen).some((key) => !["tiles", "wind"].includes(key)))
			throw new Error("Map contains presentation or unsupported terrain");
	}
	return map;
}
