import Phaser from "phaser";
import type { AssetManifest } from "../content/assets";
import { PRESENTATION } from "./config";
import { TowerScene } from "./TowerScene";
import type { GameRuntime, PresentationHooks } from "./types";

export function createGame(
	parent: HTMLElement,
	manifest: AssetManifest,
	runtime: GameRuntime,
	onReady: () => void,
	onError: (message: string) => void,
	hooks: PresentationHooks = {},
): Phaser.Game {
	return new Phaser.Game({
		type: Phaser.AUTO,
		width: PRESENTATION.width,
		height: PRESENTATION.height,
		parent,
		pixelArt: true,
		roundPixels: true,
		backgroundColor: "#000000",
		scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
		callbacks: {
			postBoot: (game) => {
				const canvas = game.canvas;
				canvas.tabIndex = 0;
				// Phaser chặn mousedown mặc định; trả focus về game bằng pointerdown.
				canvas.addEventListener("pointerdown", () =>
					canvas.focus({ preventScroll: true }),
				);
			},
		},
		scene: [new TowerScene(manifest, runtime, onReady, onError, hooks)],
		audio: { noAudio: true },
	});
}
