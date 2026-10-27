import type Phaser from "phaser";
import type { Crown } from "../../network/contracts";
import { ENDING_FRAMES } from "./endingFrames";

// Vương miện vẽ sẵn trong các tư thế ending; tọa độ tương đối theo từng frame.
const BAKED_CROWNS: readonly [string, number, number, number, number][] = [
	["normal.snatch", 10, 3, 10, 5],
	["normal.charge", 11, 12, 10, 10],
	["normal.idle_left", 12, 3, 10, 5],
	["normal.idle_right", 10, 3, 10, 5],
	["normal.walk_left0", 11, 2, 10, 5],
	["normal.walk_left1", 11, 3, 10, 5],
	["normal.walk_left2", 11, 2, 10, 5],
	["normal.walk_right0", 11, 2, 10, 5],
	["normal.walk_right1", 11, 3, 10, 5],
	["normal.walk_right2", 11, 2, 10, 5],
	["normal.snatch_smear", 26, 3, 14, 7],
	["normal.dunk", 27, 28, 12, 6],
	["normal.parasol", 27, 29, 10, 5],
	["normal.fly0", 27, 29, 10, 5],
	["normal.fly1", 27, 29, 10, 5],
	["normal.fly2", 27, 29, 10, 5],
	["normal.upskirt0", 21, 29, 10, 8],
	["normal.upskirt1", 21, 29, 10, 8],
	["normal.upskirt2", 21, 29, 10, 8],
	["cherub.deliver0", 11, 13, 10, 5],
	["cherub.deliver1", 11, 13, 10, 5],
];

export function crownTexture(key: string, crown: Crown): string {
	return crown === "BLACK" ? `${key}/diamond` : key;
}

export function createCrownTextures(scene: Phaser.Scene, crown: string): void {
	for (const [key, regions] of [
		[crown, null],
		[
			"king/base",
			BAKED_CROWNS.map(([key, x, y, width, height]) => {
				const frame = ENDING_FRAMES[key];
				if (!frame) throw new Error("Unknown ending crown frame");
				return [frame.x + x, frame.y + y, width, height] as const;
			}),
		],
		["props/textures/raven/raven_crown", [[0, 26, 168, 22]]],
		["ending/imagecrown", [[178, 0, 92, 70]]],
	] as const) {
		const name = crownTexture(key, "BLACK");
		if (scene.textures.exists(name)) continue;
		const source = scene.textures.get(key).getSourceImage() as HTMLImageElement;
		const texture = scene.textures.createCanvas(
			name,
			source.width,
			source.height,
		);
		if (!texture) throw new Error("Could not create diamond crown texture");
		const context = texture.getContext();
		context.drawImage(source, 0, 0);
		for (const [x, y, width, height] of regions ?? [
			[0, 0, source.width, source.height],
		]) {
			const pixels = context.getImageData(x, y, width, height);
			// Ba sắc xanh tạo mặt cắt kim cương; giữ điểm phản sáng trắng và outline gốc.
			for (let i = 0; i < pixels.data.length; i += 4) {
				const r = pixels.data[i] ?? 0,
					g = pixels.data[i + 1] ?? 0,
					b = pixels.data[i + 2] ?? 0;
				if (r < 100 || g < 80 || b > 80 || r < g * 0.9) continue;
				const shade = (r + g) / 2;
				const color =
					shade < 175
						? [22, 92, 173]
						: shade < 220
							? [33, 151, 218]
							: [91, 225, 250];
				pixels.data.set(color, i);
			}
			context.putImageData(pixels, x, y);
		}
		texture.refresh();
	}
}
