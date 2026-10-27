import Phaser from "phaser";
import rules from "../../../../common/rules.json";
import { required } from "../../required";
import {
	type AssetManifest,
	assetUrl,
	type Npc,
	type Prop,
} from "../content/assets";
import { PHYSICS } from "../simulation/tuning";
import { AdventureVisuals } from "./AdventureVisuals";
import { ConversationVisuals } from "./ConversationVisuals";
import { PLAYER_FRAMES, PRESENTATION as V } from "./config";
import { createCrownTextures, crownTexture } from "./crownTextures";
import { ENDING_FRAMES, endingFrameName } from "./endingFrames";
import { MainBabeEnding } from "./MainBabeEnding";
import { PlayerNames } from "./PlayerNames";
import { playerFrame } from "./playerFrame";
import type {
	GameRuntime,
	PresentationHooks,
	RenderPlayer,
	WorldFrame,
} from "./types";

interface Avatar {
	color?: string;
	sprite: Phaser.GameObjects.Sprite;
	crown: Phaser.GameObjects.Sprite;
}
export class TowerScene extends Phaser.Scene {
	private avatars = new Map<string, Avatar>();
	private names?: PlayerNames;
	private visuals: Phaser.GameObjects.GameObject[] = [];
	private background: {
		sprite: Phaser.GameObjects.TileSprite;
		speed: number;
	}[] = [];
	private weather: {
		sprite: Phaser.GameObjects.TileSprite;
		textures: string[];
		fps: number;
	}[] = [];
	private npcSprites: { data: Npc; sprite: Phaser.GameObjects.Sprite }[] = [];
	private props: {
		sprite: Phaser.GameObjects.Sprite;
		data: Prop;
		durations: number[];
		duration: number;
	}[] = [];
	private screen = -1;
	private ready = false;
	private itemGraphics?: Phaser.GameObjects.Graphics;
	private loadFailed = false;
	private adventureVisuals?: AdventureVisuals;
	private conversations?: ConversationVisuals;
	private ending?: MainBabeEnding;
	private endingId?: string;
	private babe?: Phaser.GameObjects.Sprite;
	constructor(
		private manifest: AssetManifest,
		private runtime: GameRuntime,
		private onReady: () => void,
		private onError: (message: string) => void,
		private hooks: PresentationHooks = {},
	) {
		super("Tower");
	}
	preload(): void {
		for (const [key, texture] of Object.entries(this.manifest.textures))
			this.load.image(key, assetUrl(texture.file));
		for (const [key, font] of Object.entries(this.manifest.fonts))
			this.load.bitmapFont(key, assetUrl(font.texture), assetUrl(font.data));
		this.load.on("loaderror", (file: Phaser.Loader.File) => {
			this.loadFailed = true;
			this.onError(`Could not load ${file.key}`);
		});
	}
	create(): void {
		if (this.loadFailed) return;
		this.names = new PlayerNames(required(this.game.canvas.parentElement));
		const destroyNames = () => {
			this.names?.destroy();
			this.names = undefined;
			this.events.off(Phaser.Scenes.Events.SHUTDOWN, destroyNames);
			this.events.off(Phaser.Scenes.Events.DESTROY, destroyNames);
		};
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, destroyNames);
		this.events.once(Phaser.Scenes.Events.DESTROY, destroyNames);
		createCrownTextures(this, this.manifest.crown);
		for (const key of [
			"king/base",
			this.manifest.crown,
			crownTexture(this.manifest.crown, "BLACK"),
		]) {
			const texture = this.textures.get(key);
			PLAYER_FRAMES.forEach((name, i) => {
				if (!texture.has(name))
					texture.add(
						name,
						0,
						V.spriteStartX + (i % V.spriteColumns) * V.spriteSize,
						Math.floor(i / V.spriteColumns) * V.spriteSize,
						V.spriteSize,
						V.spriteSize,
					);
			});
		}
		this.itemGraphics = this.add.graphics().setDepth(10);
		this.adventureVisuals = new AdventureVisuals(this, this.manifest);
		this.conversations = new ConversationVisuals(this, this.manifest);
		this.ready = true;
		this.render(this.runtime.frame());
		this.onReady();
	}
	update(_time: number, delta: number): void {
		if (!this.ready) return;
		if (this.ending) {
			if (this.runtime.frame().ending?.id === this.endingId) {
				this.ending.update();
				return;
			}
			this.ending.dispose();
			this.ending = undefined;
			this.endingId = undefined;
			this.screen = -1;
		}
		this.runtime.advance(delta);
		const frame = this.runtime.frame();
		this.render(frame);
		const state = frame.self.state,
			world = frame.world;
		const seconds = state.ticks / PHYSICS.tickRate;
		for (const layer of this.background)
			layer.sprite.tilePositionX = layer.speed * seconds;
		for (const weather of this.weather) {
			weather.sprite.setTexture(
				required(
					weather.textures[
						Math.floor(seconds * weather.fps) % weather.textures.length
					],
				),
			);
			weather.sprite.tilePositionX =
				world.weatherWind *
				required(this.manifest.textures[required(weather.textures[0])]).width;
		}
		for (const { sprite, data, durations, duration } of this.props) {
			const count = data.cells.X * data.cells.Y;
			if (durations.length) {
				let elapsed = duration ? seconds % duration : 0;
				for (let i = 0; i < durations.length; i++) {
					if (elapsed < required(durations[i])) {
						sprite.setFrame(String(i));
						break;
					}
					elapsed -= required(durations[i]);
				}
			} else sprite.setFrame(String(Math.floor(seconds * data.fps) % count));
		}
	}
	private avatar(player: RenderPlayer, self: boolean): void {
		let avatar = this.avatars.get(player.id);
		if (!avatar) {
			avatar = {
				sprite: this.add
					.sprite(0, 0, "king/base", "idle")
					.setOrigin(0.5, 1)
					.setName(`player:${player.id}`),
				crown: this.add
					.sprite(0, 0, this.manifest.crown, "idle")
					.setOrigin(0.5, 1)
					.setVisible(false),
			};
			this.avatars.set(player.id, avatar);
		}
		if (avatar.color !== player.color) {
			avatar.color = player.color;
			avatar.sprite.setTint(
				Phaser.Display.Color.HexStringToColor(player.color).color,
			);
		}
		const s = player.state,
			visible = s.screen === this.screen;
		avatar.sprite
			.setPosition(
				Math.trunc(s.x) + PHYSICS.bodyWidth / 2,
				Math.trunc(s.y) + PHYSICS.bodyHeight,
			)
			.setFrame(playerFrame(s))
			.setFlipX(s.direction === -1)
			.setAlpha(self ? 1 : V.peerOpacity)
			.setDepth(self ? V.selfDepth : V.peerDepth)
			.setVisible(visible);
		avatar.crown
			.setPosition(avatar.sprite.x, avatar.sprite.y)
			.setTexture(
				crownTexture(this.manifest.crown, player.crown),
				avatar.sprite.frame.name,
			)
			.setFlipX(avatar.sprite.flipX)
			.setDepth(avatar.sprite.depth + 0.1)
			.setAlpha(avatar.sprite.alpha)
			.setVisible(visible && player.crown !== "NONE");
	}
	private render(frame: WorldFrame): void {
		if (frame.self.state.screen !== this.screen)
			this.drawScreen(frame.self.state.screen);
		this.itemGraphics?.clear();
		for (const b of frame.items?.bananas ?? []) {
			const x = Math.round(b.x),
				y = Math.round(b.y);
			// Hình nhỏ, màu dịu; dùng world coordinates và không tải thêm asset ngoài.
			this.itemGraphics?.fillStyle(0xb9a34d, 0.85).fillPoints(
				[
					{ x: x - 6, y: y - 1 },
					{ x: x - 2, y: y - 3 },
					{ x, y: y - 6 },
					{ x: x + 2, y: y - 3 },
					{ x: x + 6, y: y - 1 },
					{ x: x + 1, y: y - 1 },
					{ x, y: y - 3 },
					{ x: x - 1, y: y - 1 },
				],
				true,
			);
		}
		for (const r of frame.items?.rocks ?? []) {
			const age = frame.self.state.ticks - r.tick;
			if (age < 0 || age >= rules.items.rockEffectTicks) continue;
			const offset = 24 * (1 - age / rules.items.rockEffectTicks);
			this.itemGraphics
				?.fillStyle(0xb4b4ae, 0.9)
				.fillCircle(r.x - r.direction * offset, r.y, 3);
		}
		const present = new Set([
			frame.self.id,
			...frame.peers.map((peer) => peer.id),
		]);
		for (const [id, avatar] of this.avatars)
			if (!present.has(id)) {
				avatar.sprite.destroy();
				avatar.crown.destroy();
				this.avatars.delete(id);
			}
		for (const peer of frame.peers) this.avatar(peer, false);
		this.avatar(frame.self, true);
		this.adventureVisuals?.render(frame);
		this.conversations?.render(frame, this.npcSprites);
		this.names?.render(
			[frame.self, ...frame.peers],
			this.screen,
			this.conversations?.bounds || [],
			Boolean(frame.ending),
		);
		if (frame.ending && !this.ending) {
			this.endingId = frame.ending.id;
			for (const avatar of this.avatars.values()) {
				avatar.sprite.setVisible(false);
				avatar.crown.setVisible(false);
			}
			this.babe?.setVisible(false);
			this.ending = new MainBabeEnding(
				this,
				this.manifest,
				frame.ending,
				(key) => this.hooks.onSound?.(key),
				() => this.hooks.onEndingComplete?.(),
			);
			this.hooks.onEndingStart?.(() => this.ending?.skip());
		}
	}
	private addFrames(key: string, columns: number, rows: number): void {
		const info = required(this.manifest.textures[key]),
			texture = this.textures.get(key);
		const width = info.width / columns,
			height = info.height / rows;
		for (let i = 0; i < columns * rows; i++)
			if (!texture.has(String(i)))
				texture.add(
					String(i),
					0,
					(i % columns) * width,
					Math.floor(i / columns) * height,
					width,
					height,
				);
	}
	private drawProp(prop: Prop, top: number): void {
		if (!prop.texture) return;
		const key = prop.texture;
		this.addFrames(key, prop.cells.X, prop.cells.Y);
		const sprite = this.add
			.sprite(prop.Position.X, prop.Position.Y + top, key, "0")
			.setOrigin(0)
			.setDepth(4)
			.setFlipX(!!prop.flipped);
		const durations = prop.durations.length
			? Array.from(
					{ length: prop.cells.X * prop.cells.Y },
					(_, i) => prop.durations[i] || 1 / prop.fps,
				)
			: [];
		this.visuals.push(sprite);
		this.props.push({
			sprite,
			data: prop,
			durations,
			duration: durations.reduce((sum, value) => sum + value, 0),
		});
	}
	private drawScreen(index: number): void {
		for (const visual of this.visuals) visual.destroy();
		this.visuals = [];
		this.background = [];
		this.weather = [];
		this.npcSprites = [];
		this.props = [];
		this.babe = undefined;
		this.screen = index;
		const screen = required(this.manifest.screens[index]),
			top = -index * V.height;
		this.cameras.main.setScroll(0, top);
		for (const key of screen.layers)
			this.visuals.push(
				this.add
					.image(0, top, key)
					.setOrigin(0)
					.setDepth(
						key.includes("/foreground/")
							? V.foregroundDepth
							: key.includes("/midground/")
								? 3
								: 0,
					),
			);
		for (const prop of screen.props) this.drawProp(prop, top);
		const scrolling = screen.scrolling?.ScrollingBGdata;
		const layers = scrolling?.layers?.Layer;
		for (const layer of layers
			? Array.isArray(layers)
				? layers
				: [layers]
			: []) {
			const key = `screens/scrolling/textures/${layer.texture}`,
				info = required(this.manifest.textures[key]);
			const sprite = this.add
				.tileSprite(0, top + (layer.position || 0), V.width, info.height, key)
				.setOrigin(0)
				.setDepth(layer.foreground ? 21 : 1);
			this.visuals.push(sprite);
			this.background.push({
				sprite,
				speed: (scrolling?.scroll_speed || 0) * (layer.scroll_multiplier ?? 1),
			});
		}
		for (const weather of screen.weather) {
			const keys = Object.keys(this.manifest.textures).filter((key) =>
				key.startsWith(`particles/${weather.name}/`),
			);
			if (!keys.length) continue;
			const sprite = this.add
				.tileSprite(0, top, V.width, V.height, required(keys[0]))
				.setOrigin(0)
				.setDepth(weather.foreground ? 22 : 7);
			const info = required(this.manifest.textures[required(keys[0])]);
			sprite.setTileScale(
				V.width / (Math.trunc(V.width / info.width) * info.width),
				V.height / (Math.trunc(V.height / info.height) * info.height),
			);
			this.visuals.push(sprite);
			this.weather.push({ sprite, textures: keys, fps: weather.fps });
			if (weather.mask) {
				const mask = this.make
					.image({ x: 0, y: top, key: weather.mask, add: false })
					.setOrigin(0)
					.setDisplaySize(V.width, V.height);
				sprite.setMask(mask.createBitmapMask());
				sprite.once("destroy", () => sprite.clearMask(true));
				this.visuals.push(mask);
			}
		}
		for (const npc of this.manifest.npcs.filter(
			(npc) => npc.screen === index,
		)) {
			this.addFrames(npc.texture, npc.cells.X, npc.cells.Y);
			const sprite = this.add
				.sprite(npc.position.X, top + npc.position.Y, npc.texture, "0")
				.setOrigin(0.5, 1)
				.setDepth(9)
				.setFlipX(npc.bubble.direction === "Left");
			this.visuals.push(sprite);
			this.npcSprites.push({ data: npc, sprite });
		}
		if (index === this.manifest.screens.length - 1) {
			const frame = required(ENDING_FRAMES["babe.idle0"]),
				texture = this.textures.get("king/base"),
				name = endingFrameName("babe.idle0");
			if (!texture.has(name))
				texture.add(name, 0, frame.x, frame.y, frame.width, frame.height);
			this.babe = this.add
				.sprite(348, top + 138, "king/base", name)
				.setDepth(9);
			this.visuals.push(this.babe);
		}
		const finish = this.runtime.finishMarker;
		if (finish?.screen === index) {
			const size = V.finishFlagSize,
				x = finish.x + finish.width / 2,
				y = finish.y - V.finishPoleHeight,
				flag = this.add.graphics().setDepth(V.finishDepth);
			flag.lineStyle(2, V.finishColor);
			flag.lineBetween(
				finish.x,
				finish.y - 1,
				finish.x + finish.width,
				finish.y - 1,
			);
			flag.lineBetween(x, y, x, finish.y);
			for (let row = 0; row < 2; row++)
				for (let column = 0; column < 3; column++)
					flag
						.fillStyle((row + column) % 2 ? 0x111111 : 0xffffff)
						.fillRect(x + column * size, y + row * size, size, size);
			const label = this.add
				.text(x, y - size, "FINISH", {
					fontFamily: "monospace",
					fontSize: V.finishFontSize,
					fontStyle: "bold",
					color: "#ffffff",
					stroke: "#000000",
					strokeThickness: 3,
				})
				.setOrigin(0.5, 1)
				.setDepth(V.finishDepth)
				.setTint(V.finishColor)
				.setName("room-finish");
			label.x = Phaser.Math.Clamp(
				label.x,
				label.width / 2,
				V.width - label.width / 2,
			);
			this.visuals.push(flag, label);
		}
	}
}
