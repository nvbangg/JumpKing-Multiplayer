import Phaser from "phaser";
import { required } from "../../required";
import type { AssetManifest } from "../content/assets";
import { PHYSICS as P } from "../simulation/tuning";
import { PRESENTATION as V } from "./config";
import { crownTexture } from "./crownTextures";
import {
	endingFrameName,
	ENDING_FRAMES as FRAMES,
	ENDING_PATHS as PATH,
} from "./endingFrames";
import type { EndingSignal } from "./types";

interface Actor {
	root: Phaser.GameObjects.Container;
	texture: string;
	frame: string;
	sprites: Phaser.GameObjects.Sprite[];
	king: boolean;
}
interface Loop {
	actor: Actor;
	frames: string[];
	durations: number[];
	startedAt: number;
}
export class MainBabeEnding {
	state: "PLAYING" | "PICTURE" | "DISPOSED" = "PLAYING";
	private timers = new Set<Phaser.Time.TimerEvent>();
	private tweens = new Set<Phaser.Tweens.Tween>();
	private actors: Actor[] = [];
	private loops = new Map<Actor, Loop>();
	private world: Phaser.GameObjects.Container;
	private hud: Phaser.GameObjects.Container;
	private camera: { x: number; y: number };
	private crowned = false;
	private picture?: Phaser.GameObjects.Image;
	constructor(
		private scene: Phaser.Scene,
		private manifest: AssetManifest,
		private signal: EndingSignal,
		private onSound: (key: string) => void,
		private onPicture: () => void,
	) {
		this.camera = {
			x: scene.cameras.main.scrollX,
			y: scene.cameras.main.scrollY,
		};
		this.world = scene.add
			.container(0, -signal.screen * V.height)
			.setDepth(V.endingDepth);
		this.hud = scene.add
			.container(0, 0)
			.setScrollFactor(0)
			.setDepth(V.endingDepth + 1);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.dispose, this);
		const end = this.timeline();
		this.at(end, () => this.toPicture());
	}
	private at(seconds: number, action: () => void): void {
		const timer = this.scene.time.delayedCall(
			Math.max(0, seconds * 1000),
			() => {
				this.timers.delete(timer);
				if (this.state === "PLAYING") action();
			},
		);
		this.timers.add(timer);
	}
	private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): void {
		const tween = this.scene.tweens.add({
			...config,
			onComplete: () => this.tweens.delete(tween),
		});
		this.tweens.add(tween);
	}
	private register(texture: string, key: string): string {
		const frame = FRAMES[key];
		if (!frame) throw new Error("Unknown ending frame");
		const atlas = this.scene.textures.get(texture),
			name = endingFrameName(key);
		if (!atlas.has(name))
			atlas.add(name, 0, frame.x, frame.y, frame.width, frame.height);
		return name;
	}
	private actor(
		x: number,
		y: number,
		frame: string,
		hud = false,
		texture = "king/base",
		king = false,
	): Actor {
		const actor = {
			root: this.scene.add.container(x, y),
			texture,
			frame,
			king,
			sprites: [] as Phaser.GameObjects.Sprite[],
		};
		(hud ? this.hud : this.world).add(actor.root);
		this.actors.push(actor);
		this.dress(actor);
		return actor;
	}
	private dress(actor: Actor): void {
		for (const sprite of actor.sprites) sprite.destroy();
		const textures = [
			actor.texture,
			...(actor.king && this.crowned
				? [crownTexture(this.manifest.crown, this.signal.crown)]
				: []),
		];
		actor.sprites = textures.map((texture) => {
			const frame = required(FRAMES[actor.frame]);
			const sprite = this.scene.add
				.sprite(0, 0, texture, this.register(texture, actor.frame))
				.setOrigin(frame.originX, frame.originY);
			actor.root.add(sprite);
			return sprite;
		});
	}
	private apply(actor: Actor, key: string): void {
		actor.frame = key;
		const frame = required(FRAMES[key]);
		for (const sprite of actor.sprites)
			sprite
				.setFrame(this.register(sprite.texture.key, key))
				.setOrigin(frame.originX, frame.originY);
	}
	private frame(actor: Actor, key: string, time: number): void {
		this.at(time, () => {
			this.loops.delete(actor);
			this.apply(actor, key);
		});
	}
	private animate(
		actor: Actor,
		frames: string[],
		durations: number[],
		time: number,
	): void {
		this.at(time, () => {
			this.loops.set(actor, {
				actor,
				frames,
				durations,
				startedAt: this.scene.time.now,
			});
			this.apply(actor, required(frames[0]));
		});
	}
	private loop(actor: Actor, frames: string[], time: number, step = 0.2): void {
		this.animate(
			actor,
			frames,
			frames.map(() => step * 1000),
			time,
		);
	}
	private walk(actor: Actor, frames: string[], time: number, speed = 1): void {
		this.animate(
			actor,
			frames,
			[10, 4, 10, 4].map((ticks) => (ticks * 1000) / (P.tickRate * speed)),
			time,
		);
	}
	update(): void {
		if (this.state !== "PLAYING") return;
		for (const loop of this.loops.values()) {
			let elapsed =
				(this.scene.time.now - loop.startedAt) %
				loop.durations.reduce((a, b) => a + b, 0);
			for (let i = 0; i < loop.frames.length; i++) {
				if (elapsed < required(loop.durations[i])) {
					if (loop.actor.frame !== loop.frames[i])
						this.apply(loop.actor, required(loop.frames[i]));
					break;
				}
				elapsed -= required(loop.durations[i]);
			}
		}
	}
	private move(
		target: { x: number; y: number },
		time: number,
		duration: number,
		dx: number,
		dy: number,
	): void {
		this.at(time, () =>
			this.tween({
				targets: target,
				...(dx ? { x: target.x + dx } : {}),
				...(dy ? { y: target.y + dy } : {}),
				duration: duration * 1000,
				ease: "Linear",
			}),
		);
	}
	private pan(time: number, duration: number, dx: number, dy: number): void {
		this.at(time, () => {
			const camera = this.scene.cameras.main;
			this.tween({
				targets: camera,
				...(dx ? { scrollX: camera.scrollX - dx } : {}),
				...(dy ? { scrollY: camera.scrollY - dy } : {}),
				duration: duration * 1000,
				ease: "Linear",
			});
		});
	}
	private trajectory(actor: Actor, time: number, points: number[]): number {
		const duration = (points.length - 1) / P.tickRate;
		this.at(time, () => {
			const y = actor.root.y;
			this.tween({
				targets: actor.root,
				y: y + required(points.at(-1)),
				duration: duration * 1000,
				ease: "Linear",
				onUpdate: (tween: Phaser.Tweens.Tween) => {
					const index = Math.min(
							points.length - 1,
							tween.progress * (points.length - 1),
						),
						i = Math.floor(index);
					actor.root.y =
						y +
						Phaser.Math.Linear(
							required(points[i]),
							required(points[Math.min(i + 1, points.length - 1)]),
							index - i,
						);
				},
			});
		});
		return duration;
	}
	private sound(key: string, time: number): void {
		this.at(time, () => this.onSound(key));
	}
	private awardCrown(time: number): void {
		this.at(time, () => {
			this.crowned = true;
			for (const actor of this.actors.filter((value) => value.king))
				this.dress(actor);
		});
	}
	private cherubs(time: number): { actor: Actor; delivered: number } {
		const raven = this.signal.ravenDone;
		const actor = this.actor(
			479,
			2,
			raven ? "ravenCrown.0" : "cherub.deliver0",
			true,
			raven
				? crownTexture("props/textures/raven/raven_crown", this.signal.crown)
				: "king/base",
		);
		actor.root.setName("ending-crown-carrier");
		actor.root.setVisible(false);
		this.at(time, () => actor.root.setVisible(true));
		this.loop(
			actor,
			raven
				? ["ravenCrown.0", "ravenCrown.1", "ravenCrown.2"]
				: ["cherub.deliver0", "cherub.deliver1"],
			time,
			raven ? 0.1 : 1 / 30,
		);
		const x = [480],
			y = [0];
		let currentX = 480,
			currentY = 0,
			lastY = 0;
		for (let tick = 1; tick <= 60; tick++) {
			currentX += tick < 40 ? -5 : Math.max(-5, -(currentX - 240) * 0.25);
			const previous = currentY;
			currentY +=
				(135 - (lastY * 0.25 + currentY * 0.75)) * (tick < 40 ? 0.05 : 0.06);
			lastY = previous;
			if (tick < 60) {
				x.push(currentX);
				y.push(currentY);
			}
		}
		this.at(time, () =>
			this.tween({
				targets: actor.root,
				x: required(x.at(-1)) - 1,
				y: required(y.at(-1)) + 2,
				duration: 4000,
				ease: "Linear",
				onUpdate: (tween: Phaser.Tweens.Tween) => {
					const sample = Math.max(0, Math.min(59, tween.progress * 60 - 1)),
						i = Math.floor(sample);
					actor.root.setPosition(
						Phaser.Math.Linear(
							required(x[i]),
							required(x[Math.min(59, i + 1)]),
							sample - i,
						) - 1,
						Phaser.Math.Linear(
							required(y[i]),
							required(y[Math.min(59, i + 1)]),
							sample - i,
						) + 2,
					);
				},
			}),
		);
		return { actor, delivered: time + 4 };
	}
	private escape(actor: Actor, time: number): void {
		const raven = this.signal.ravenDone;
		if (raven)
			this.at(time, () => {
				actor.texture = "props/textures/raven/raven";
				actor.frame = "ravenFly.0";
				this.dress(actor);
			});
		this.loop(
			actor,
			raven
				? ["ravenFly.0", "ravenFly.1", "ravenFly.2"]
				: ["cherub.escape0", "cherub.escape1"],
			time,
			raven ? 0.1 : 1 / 30,
		);
		this.at(time, () => {
			let x = actor.root.x,
				y = actor.root.y,
				vx = 0,
				vy = -0.1;
			const points = [{ x, y }];
			for (let i = 1; i < 1000; i++) {
				if (i % 4 === 0) {
					vx += 0.5;
					vy *= 1.2;
				}
				x += vx / 4;
				y += vy / 4;
				points.push({ x, y });
				if (x < 0 || x >= V.width || y < 2 || y >= V.height) break;
			}
			const duration = (points.length - 1) / P.tickRate;
			this.tween({
				targets: actor.root,
				x,
				y,
				duration: duration * 1000,
				ease: "Linear",
				onUpdate: (tween: Phaser.Tweens.Tween) => {
					const index = Math.min(
							points.length - 1,
							tween.progress * (points.length - 1),
						),
						i = Math.floor(index),
						next = required(points[Math.min(i + 1, points.length - 1)]);
					actor.root.setPosition(
						Phaser.Math.Linear(required(points[i]).x, next.x, index - i),
						Phaser.Math.Linear(required(points[i]).y, next.y, index - i),
					);
				},
			});
			this.at(duration, () => actor.root.setVisible(false));
		});
	}
	private timeline(): number {
		const king = this.actor(336, 144, "regular.idle", false, "king/base", true),
			babe = this.actor(396, 128, "babe.idle0");
		this.loop(babe, ["babe.idle0", "babe.idle1", "babe.idle2"], 0, 0.1);
		const steps = Math.round(Math.hypot(96, 96) / 0.5),
			pan = steps / P.tickRate;
		this.pan(0, pan, -Math.SQRT1_2 * 0.5 * steps, Math.SQRT1_2 * 0.5 * steps);
		let t = pan + 1;
		this.frame(babe, "babe.charge", t);
		t += 0.5;
		this.frame(babe, "babe.up", t);
		this.sound("audio/babe/babe jump", t);
		this.frame(babe, "babe.fall", t + 11 / P.tickRate);
		t += this.trajectory(babe, t, PATH.babe);
		this.frame(babe, "babe.land", t);
		this.sound("audio/jump_king/king_land", t);
		t += 0.1;
		this.loop(babe, ["babe.idle0", "babe.idle1", "babe.idle2"], t, 0.1);
		t += 0.5;
		this.move(babe.root, t, 44 / 30, -44, 0);
		t += 44 / 30 + 0.4;
		this.frame(babe, "babe.kiss", t);
		this.sound("audio/babe/babe kiss", t);
		t += 0.5;
		this.loop(babe, ["babe.idle0", "babe.idle1", "babe.idle2"], t, 0.1);
		const cherub = this.cherubs(t);
		this.frame(king, "regular.look_up", t + 1);
		this.move(babe.root, t + 1, 8 / 30, 8, 0);
		t = cherub.delivered;
		this.frame(king, "regular.charge", t);
		t += 0.5;
		this.frame(king, "regular.up", t);
		this.sound("audio/jump_king/king_jump", t);
		t += this.trajectory(king, t, PATH.crownUp);
		this.sound("audio/plink", t);
		this.awardCrown(t);
		t += 1;
		this.escape(cherub.actor, t);
		this.frame(king, "regular.fall", t);
		t += this.trajectory(king, t, PATH.crownDown);
		this.sound("audio/jump_king/king_land", t);
		this.frame(king, "regular.idle", t);
		t += 1;
		this.frame(king, "normal.snatch", t);
		t += 1;
		this.sound("audio/jump_king/king_jump", t);
		this.frame(king, "normal.snatch_smear", t);
		this.at(t, () => babe.root.setVisible(false));
		this.sound("audio/babe/babe pickup", t);
		t += 1 / 30;
		this.frame(king, "normal.idle_right", t);
		t += 1;
		this.walk(
			king,
			[
				"normal.walk_left0",
				"normal.walk_left1",
				"normal.walk_left2",
				"normal.walk_left1",
			],
			t,
		);
		this.move(king.root, t, 2, -90, 0);
		t += 2;
		this.frame(king, "normal.idle_right", t);
		t += 2;
		this.walk(
			king,
			[
				"normal.walk_right0",
				"normal.walk_right1",
				"normal.walk_right2",
				"normal.walk_right1",
			],
			t,
			2,
		);
		this.sound("audio/babe/babe surprised2", t);
		this.sound("audio/babe/babe surprised2", t);
		this.move(king.root, t, 16 / 30, 96, 0);
		t += 16 / 30;
		this.move(king.root, t, 7 / 30, 42, 0);
		this.pan(t, 14 / P.tickRate, -42, 0);
		t += 7 / 30;
		this.frame(king, "normal.charge", t);
		t += 0.6;
		this.frame(king, "normal.dunk", t);
		this.sound("audio/jump_king/king_jump", t);
		this.sound("audio/babe/babe scream", t);
		const jump = this.trajectory(king, t, PATH.full);
		this.move(king.root, t, jump, 3.5 * 69, 0);
		this.pan(t, jump, -3.5 * 69, 0);
		t += jump;
		this.frame(king, "normal.parasol", t);
		this.sound("audio/jump_king/king_jump", t);
		this.move(king.root, t, 10 / 30, 35, -30);
		this.pan(t, 10 / 30, -35, -10);
		t += 10 / 30;
		this.loop(king, ["normal.fly0", "normal.fly1", "normal.fly2"], t);
		this.move(king.root, t, 9, 105 * 9, 30 * 9);
		this.pan(t, 9, -105 * 9, -30 * 9);
		this.sound("audio/babe/babe mou", t + 3.5500002);
		this.loop(
			king,
			["normal.upskirt0", "normal.upskirt1", "normal.upskirt2"],
			t + 3.5500002,
		);
		this.loop(
			king,
			["normal.fly0", "normal.fly1", "normal.fly2"],
			t + 5.5500002,
		);
		return t + 8.5500002;
	}
	skip(): void {
		if (this.state === "PLAYING") this.toPicture();
	}
	private clear(): void {
		for (const timer of this.timers) timer.remove(false);
		this.timers.clear();
		for (const tween of this.tweens) tween.remove();
		this.tweens.clear();
		this.loops.clear();
	}
	private toPicture(): void {
		if (this.state !== "PLAYING") return;
		this.state = "PICTURE";
		this.clear();
		this.world.destroy(true);
		this.hud.destroy(true);
		this.scene.cameras.main.setScroll(this.camera.x, this.camera.y);
		this.picture = this.scene.add
			.image(0, 0, crownTexture("ending/imagecrown", this.signal.crown))
			.setOrigin(0)
			.setScrollFactor(0)
			.setDepth(V.endingDepth + 2)
			.setName("ending-picture");
		this.onPicture();
	}
	dispose(): void {
		if (this.state === "DISPOSED") return;
		this.state = "DISPOSED";
		this.clear();
		this.picture?.destroy();
		if (this.world.scene) this.world.destroy(true);
		if (this.hud.scene) this.hud.destroy(true);
		this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.dispose, this);
	}
}
