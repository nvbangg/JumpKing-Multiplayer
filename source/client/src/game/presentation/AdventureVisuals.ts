import type Phaser from "phaser";
import { required } from "../../required";
import type { AssetManifest } from "../content/assets";
import { ADVENTURE } from "../simulation/Adventure";
import { PRESENTATION as V } from "./config";
import type { WorldFrame } from "./types";

export class AdventureVisuals {
	private walls = new Map<string, Phaser.GameObjects.Image>();
	private raven: Phaser.GameObjects.Sprite;
	constructor(
		scene: Phaser.Scene,
		private manifest: AssetManifest,
	) {
		const texture = scene.textures.get("props/textures/raven/raven");
		for (let i = 0; i < 8; i++)
			texture.add(
				`raven-idle:${i}`,
				0,
				(i % 4) * 32,
				Math.floor(i / 4) * 32,
				32,
				32,
			);
		for (let i = 0; i < 6; i++)
			texture.add(
				`raven-fly:${i}`,
				0,
				(i % 3) * 48,
				64 + Math.floor(i / 3) * 32,
				48,
				32,
			);
		this.raven = scene.add
			.sprite(0, 0, "props/textures/raven/raven", "raven-idle:0")
			.setOrigin(0.5)
			.setDepth(9)
			.setName("raven")
			.setVisible(false);
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
		const state = frame.self.adventure?.raven;
		this.raven.setVisible(
			!!state &&
				!state.done &&
				!frame.ending &&
				required(ADVENTURE.raven.positions[state.index]).screen ===
					frame.self.state.screen,
		);
		if (state) {
			const perch = required(ADVENTURE.raven.positions[state.index]);
			const index = state.flying
				? (perch.treasure ? 3 : 0) + (Math.floor(state.ticks / 6) % 3)
				: (perch.treasure ? 4 : 0) +
					required([0, 2, 3][Math.floor(frame.self.state.ticks / 12) % 3]);
			this.raven
				.setPosition(state.x, state.y)
				.setFlipX((state.flying ? perch.flyDirection : perch.direction) < 0)
				.setFrame(`raven-${state.flying ? "fly" : "idle"}:${index}`);
		}
		for (const wall of this.manifest.walls)
			required(this.walls.get(wall.id))
				.setVisible(wall.screen === frame.self.state.screen)
				.setAlpha(
					(frame.world?.walls[wall.id]?.fadeTicks ??
						ADVENTURE.tuning.wallFadeTicks) / ADVENTURE.tuning.wallFadeTicks,
				);
	}
}
