import type Phaser from "phaser";
import type { Crown } from "../../network/contracts";

export function crownTexture(key: string, crown: Crown): string {
	return crown === "BLACK" ? `${key}/black` : key;
}

export function createCrownTextures(scene: Phaser.Scene, crown: string): void {
	for (const [key, region] of [
		[crown, null],
		[
			"props/textures/raven/raven_crown",
			{ x: 0, y: 26, width: 168, height: 22 },
		],
		["ending/imagecrown", { x: 178, y: 0, width: 92, height: 70 }],
	] as const) {
		const name = crownTexture(key, "BLACK");
		if (scene.textures.exists(name)) continue;
		const source = scene.textures.get(key).getSourceImage() as HTMLImageElement;
		const texture = scene.textures.createCanvas(
			name,
			source.width,
			source.height,
		);
		if (!texture) throw new Error("Could not create black crown texture");
		const context = texture.getContext();
		context.drawImage(source, 0, 0);
		const { x, y, width, height } = region ?? {
			x: 0,
			y: 0,
			width: source.width,
			height: source.height,
		};
		const pixels = context.getImageData(x, y, width, height);
		// Chỉ đổi các sắc vàng của crown một lần khi tải; giữ outline, đá quý và nhân vật.
		for (let i = 0; i < pixels.data.length; i += 4) {
			const r = pixels.data[i] ?? 0,
				g = pixels.data[i + 1] ?? 0,
				b = pixels.data[i + 2] ?? 0;
			if (r < 100 || g < 80 || b > 80 || r < g * 0.9) continue;
			const shade = Math.round(20 + (r + g) * 0.08);
			pixels.data[i] = shade;
			pixels.data[i + 1] = shade + 3;
			pixels.data[i + 2] = shade + 10;
		}
		context.putImageData(pixels, x, y);
		texture.refresh();
	}
}
