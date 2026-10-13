import type Phaser from "phaser";
import type { AssetManifest } from "../content/assets";
import { ADVENTURE } from "../simulation/Adventure";
import { PRESENTATION as V } from "./config";
import type { WorldFrame } from "./types";

export class AdventureVisuals {
	private walls = new Map<string, Phaser.GameObjects.Image>();
	constructor(
		scene: Phaser.Scene,
		private manifest: AssetManifest,
	) {
		for (const wall of manifest.walls)
			this.walls.set(
				wall.id,
				scene.add
					.image(
						wall.position.X,
						wall.position.Y - wall.screen * V.height,
						wall.texture,
					)
					.setOrigin(0)
					.setDepth(23),
			);
	}
	render(frame: WorldFrame): void {
		for (const wall of this.manifest.walls)
			this.walls
				.get(wall.id)!
				.setVisible(wall.screen === frame.self.state.screen)
				.setAlpha(
					(frame.world?.walls[wall.id]?.fadeTicks ??
						ADVENTURE.tuning.wallFadeTicks) / ADVENTURE.tuning.wallFadeTicks,
				);
	}
}
