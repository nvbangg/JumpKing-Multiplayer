import { required } from "../../required";
import { type AssetManifest, assetUrl } from "../content/assets";
import type { MovementEffect, PlayerState } from "../simulation/types";
import { PRESENTATION } from "./config";

export class AudioBus {
	private context: AudioContext | null = null;
	private buffers = new Map<string, AudioBuffer>();
	private loading = new Map<string, Promise<void>>();
	private sources = new Set<AudioBufferSourceNode>();
	private ambience: HTMLAudioElement[] = [];
	private screen = -1;
	private music: string | null = null;
	private musicLoop = true;
	private disposed = false;
	private suspended = false;
	private fetches = new AbortController();
	constructor(
		private manifest: AssetManifest,
		private enabled: boolean,
		private onError: (message: string) => void,
		private preloadEffects = true,
	) {
		window.addEventListener("pointerdown", this.gesture, true);
		window.addEventListener("keydown", this.gesture, true);
		if (preloadEffects) void this.unlock();
	}
	private gesture = () => {
		void this.unlock();
	};
	async unlock(): Promise<void> {
		if (!this.enabled || this.disposed) return;
		try {
			this.context ||= new AudioContext({ latencyHint: "interactive" });
			// Tải/giải mã ngay cả khi trình duyệt đang chờ thao tác để cho phép phát.
			const resumed =
				this.context.state === "suspended"
					? this.context.resume()
					: Promise.resolve();
			for (const audio of this.ambience) this.playStream(audio);
			if (this.preloadEffects)
				await Promise.all([
					resumed,
					...Object.keys(this.manifest.sounds)
						.filter(
							(key) =>
								key.startsWith("audio/jump_king/") ||
								key.startsWith("audio/gui_sfx/") ||
								[
									"audio/talking",
									"audio/plink",
									"audio/new_location",
									"audio/illusion",
									"audio/event_sfx/bird_fly",
									"audio/music/event_music/ending_jingle",
								].includes(key),
						)
						.map((key) => this.load(key)),
				]);
			else await resumed;
		} catch (cause) {
			this.report(cause);
		}
	}
	private async load(key: string): Promise<void> {
		if (this.buffers.has(key) || !this.context || this.disposed) return;
		if (this.loading.has(key)) return this.loading.get(key);
		const context = this.context;
		const pending = (async () => {
			const response = await fetch(
				assetUrl(required(this.manifest.sounds[key]).file),
				{
					signal: this.fetches.signal,
				},
			);
			if (!response.ok) throw new Error("Could not load sound");
			const buffer = await context.decodeAudioData(
				await response.arrayBuffer(),
			);
			if (!this.disposed) this.buffers.set(key, buffer);
		})().finally(() => this.loading.delete(key));
		this.loading.set(key, pending);
		return pending;
	}
	private report(cause: unknown): void {
		if (
			this.disposed ||
			(cause instanceof DOMException &&
				["AbortError", "NotAllowedError"].includes(cause.name))
		)
			return;
		this.onError("Sound could not be played. You can continue with Sound off.");
	}
	private playStream(audio: HTMLAudioElement): void {
		if (!this.enabled || this.suspended || this.disposed || !audio.paused)
			return;
		void audio.play().catch((cause) => this.report(cause));
	}
	setScreen(screen: number): void {
		if (screen === this.screen || this.disposed) return;
		this.screen = screen;
		this.music = null;
		this.clearAmbience();
		if (!this.enabled) return;
		for (const stream of this.manifest.screens[screen]?.ambience || []) {
			const key = Object.keys(this.manifest.sounds).find(
				(value) =>
					value.toLowerCase() ===
					`audio/background/${stream.name}`.toLowerCase(),
			);
			if (!key || stream.volume <= 0) continue;
			this.stream(key, stream.volume * PRESENTATION.ambienceVolume);
		}
	}
	setMusic(key: string, loop = true): void {
		if ((this.music === key && this.musicLoop === loop) || this.disposed)
			return;
		this.music = key;
		this.musicLoop = loop;
		this.screen = -1;
		this.clearAmbience();
		if (this.enabled) this.stream(key, PRESENTATION.ambienceVolume, loop);
	}
	beginEnding(): void {
		this.suspended = false;
		this.setMusic("audio/music/ending", false);
		if (this.enabled)
			void this.unlock()
				.then(() =>
					Promise.all(
						Object.keys(this.manifest.sounds)
							.filter((key) => key.startsWith("audio/babe/"))
							.map((key) => this.load(key)),
					),
				)
				.catch((cause) => this.report(cause));
	}
	private stream(key: string, volume: number, loop = true): void {
		const asset = this.manifest.sounds[key];
		if (!asset) return;
		const audio = new Audio(assetUrl(asset.file));
		audio.loop = loop;
		audio.volume = Math.min(1, volume);
		audio.preload = "auto";
		audio.onerror = () => this.report(new Error("Could not load ambience"));
		this.ambience.push(audio);
		this.playStream(audio);
	}
	play(key: string, volume: number = PRESENTATION.effectVolume): void {
		const context = this.context,
			buffer = this.buffers.get(key);
		if (
			!this.enabled ||
			this.suspended ||
			this.disposed ||
			context?.state !== "running" ||
			!buffer
		)
			return;
		const source = context.createBufferSource(),
			gain = context.createGain();
		source.buffer = buffer;
		gain.gain.value = volume;
		source.connect(gain);
		gain.connect(context.destination);
		source.onended = () => {
			this.sources.delete(source);
			source.disconnect();
			gain.disconnect();
		};
		this.sources.add(source);
		source.start();
	}
	effect(
		effect: MovementEffect,
		state: Pick<PlayerState, "snow" | "ice">,
		volume: number = PRESENTATION.effectVolume,
	): void {
		const name = effect.toLowerCase();
		const variant =
			state.snow && effect !== "BUMP"
				? `snow/king_${name}`
				: state.ice && ["JUMP", "LAND"].includes(effect)
					? `ice/king_${name}`
					: `king_${name}`;
		this.play(`audio/jump_king/${variant}`, volume);
	}
	setEnabled(enabled: boolean): void {
		if (enabled === this.enabled) return;
		this.enabled = enabled;
		if (!enabled) {
			this.clearAmbience();
			this.stopEffects();
		} else {
			const screen = this.screen,
				music = this.music,
				loop = this.musicLoop;
			this.screen = -1;
			this.music = null;
			if (music) this.setMusic(music, loop);
			else this.setScreen(screen);
			void this.unlock();
		}
	}
	pause(paused: boolean): void {
		this.suspended = paused;
		if (paused) {
			this.stopEffects();
			for (const audio of this.ambience) audio.pause();
		} else {
			for (const audio of this.ambience) this.playStream(audio);
			void this.unlock();
		}
	}
	private stopEffects(): void {
		for (const source of this.sources) source.stop();
		this.sources.clear();
	}
	private clearAmbience(): void {
		for (const audio of this.ambience) {
			audio.onerror = null;
			audio.pause();
			audio.removeAttribute("src");
			audio.load();
		}
		this.ambience = [];
	}
	dispose(): void {
		this.disposed = true;
		this.fetches.abort();
		this.clearAmbience();
		this.stopEffects();
		window.removeEventListener("pointerdown", this.gesture, true);
		window.removeEventListener("keydown", this.gesture, true);
		void this.context?.close();
		this.buffers.clear();
	}
}
