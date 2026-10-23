import { useEffect } from "react";
import { loadManifest } from "../game/content/assets";
import { AudioBus } from "../game/presentation/AudioBus";

export function useMenuMusic(
	playing: boolean,
	sound: boolean,
	onError: (message: string) => void,
) {
	useEffect(() => {
		if (playing || !sound) return;
		let disposed = false,
			music: AudioBus | undefined;
		const controller = new AbortController();
		void loadManifest(controller.signal)
			.then((manifest) => {
				if (disposed) return;
				music = new AudioBus(manifest, true, onError, false);
				music.setMusic("audio/music/menu loop/menu_loop");
			})
			.catch(() => {
				if (!disposed) onError("Menu sound could not be loaded");
			});
		return () => {
			disposed = true;
			controller.abort();
			music?.dispose();
		};
	}, [playing, sound, onError]);
}
