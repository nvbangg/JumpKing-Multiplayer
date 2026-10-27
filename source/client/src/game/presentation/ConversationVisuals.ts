import Phaser from "phaser";
import { required } from "../../required";
import type { AssetManifest, Npc } from "../content/assets";
import { ADVENTURE } from "../simulation/Adventure";
import { PHYSICS as P } from "../simulation/tuning";
import { PRESENTATION as V } from "./config";
import type { WorldFrame } from "./types";

export interface NpcSprite {
	data: Npc;
	sprite: Phaser.GameObjects.Sprite;
}
interface Bubble {
	text: Phaser.GameObjects.BitmapText;
	frame?: Phaser.GameObjects.Graphics;
	full: string;
	wrapped: string;
}
export function npcQuote(npc: Npc, id: string): string[] {
	const parts = id.split(":");
	if (id === "intro") return npc.intro;
	if (parts[0] === "progress")
		return npc.screenQuotes[Number(parts[1])]?.lines || [];
	if (parts[0] === "loop") return npc.looping[Number(parts[1])] || [];
	if (parts[0] === "flag")
		return npc.flagQuotes[Number(parts[1])]?.quotes[Number(parts[2])] || [];
	return [];
}
export class ConversationVisuals {
	private bubbles = new Map<string, Bubble>();
	constructor(
		private scene: Phaser.Scene,
		private manifest: AssetManifest,
	) {}
	get bounds() {
		return [...this.bubbles.values()]
			.filter((bubble) => bubble.text.visible)
			.map((bubble) => {
				const box = bubble.text.getBounds();
				const padding = bubble.frame ? V.bubblePadding : 0;
				return {
					x: box.x - padding,
					y: box.y - padding,
					width: box.width + padding * 2,
					height: box.height + padding * 2,
				};
			});
	}
	private bubble(id: string, font: string, framed: boolean): Bubble {
		let bubble = this.bubbles.get(id);
		if (!bubble) {
			bubble = {
				text: this.scene.add
					.bitmapText(0, 0, font, "")
					.setDepth(V.dialogueTextDepth)
					.setTint(0xe4dfcd)
					.setName(`dialogue:${id}`),
				full: "",
				wrapped: "",
			};
			if (framed)
				bubble.frame = this.scene.add.graphics().setDepth(V.dialogueFrameDepth);
			this.bubbles.set(id, bubble);
		}
		bubble.text.setVisible(true);
		bubble.frame?.setVisible(true);
		return bubble;
	}
	render(frame: WorldFrame, npcs: NpcSprite[]): void {
		const state = frame.self.adventure,
			screen = frame.self.state.screen;
		for (const bubble of this.bubbles.values()) {
			bubble.text.setVisible(false);
			bubble.frame?.setVisible(false);
		}
		if (!state) return;
		for (const { data: npc, sprite } of npcs) {
			const rule = ADVENTURE.npcs.find((value) => value.id === npc.name),
				speaker = state.dialogue[npc.name];
			let line: string | undefined,
				ticks = 0,
				characterTicks = 1;
			if (rule && speaker?.quote !== null && speaker?.quote !== undefined) {
				line = npcQuote(npc, speaker.quote)[speaker.line];
				ticks = speaker.ticks;
				characterTicks = P.tickRate * rule.characterSeconds;
			}
			if (!line) {
				const busy = speaker?.busy || 0,
					duration = npc.busy.reduce((sum, step) => sum + step.duration, 0);
				let selected = "0",
					elapsed = duration
						? ((ADVENTURE.tuning.npcBusyTicks - busy) / P.tickRate) % duration
						: 0;
				if (busy > 0)
					for (const step of npc.busy) {
						if (elapsed < step.duration) {
							selected = String(step.sprite_index);
							break;
						}
						elapsed -= step.duration;
					}
				sprite.setFrame(selected);
				continue;
			}
			const bubble = this.bubble(npc.name, npc.font, true),
				width = npc.bubble.width;
			bubble.text
				.setMaxWidth(width - V.bubblePadding * 2)
				.setText(line.substring(0, Math.floor(ticks / characterTicks)));
			const x = Phaser.Math.Clamp(
				npc.position.X - width,
				V.bubbleMargin,
				V.width - V.bubbleMargin - width,
			);
			const y =
				npc.position.Y -
				screen * V.height -
				V.bubbleOffsetY -
				bubble.text.height;
			bubble.text.setPosition(x + V.bubblePadding, y + V.bubblePadding - 1);
			required(bubble.frame)
				.clear()
				.fillStyle(0x0b100b, 0.92)
				.fillRoundedRect(
					x,
					y,
					width,
					bubble.text.height + V.bubblePadding * 2 - 2,
					3,
				)
				.lineStyle(1, 0x87906b)
				.strokeRoundedRect(
					x,
					y,
					width,
					bubble.text.height + V.bubblePadding * 2 - 2,
					3,
				);
			const animation =
				npc.talking[
					Math.floor(ticks / P.tickRate / V.npcTalkingFrameSeconds) %
						npc.talking.length
				];
			if (animation) sprite.setFrame(String(animation.sprite_index));
		}
		for (const definition of this.manifest.messages) {
			const message = state.readables[definition.id];
			if (
				definition.screen !== screen ||
				!message ||
				message.wait < ADVENTURE.tuning.readableWaitTicks ||
				message.done
			)
				continue;
			const line = definition.lines[message.line];
			if (!line) continue;
			const bubble = this.bubble(definition.id, definition.font, false),
				font = required(this.manifest.fonts[definition.font]);
			bubble.text
				.setOrigin(definition.bubble.anchor.X === "Right" ? 1 : 0, 0)
				.setLineSpacing(V.readableLineHeight - font.lineHeight);
			if (definition.bubble.anchor.X === "Right") bubble.text.setRightAlign();
			if (bubble.full !== line) {
				bubble.full = line;
				bubble.text.setText(line).setMaxWidth(definition.bubble.width);
				bubble.wrapped = bubble.text.getTextBounds().wrappedText;
			}
			bubble.text
				.setMaxWidth(0)
				.setText(
					bubble.wrapped.substring(
						0,
						Math.floor(message.ticks / ADVENTURE.tuning.readableCharacterTicks),
					),
				);
			const rows = bubble.text.text.split("\n").length;
			bubble.text.setPosition(
				definition.anchor.x +
					(definition.bubble.direction === "Right"
						? V.readableOffsetX
						: -V.readableOffsetX),
				definition.anchor.y -
					screen * V.height -
					V.readableOffsetY -
					font.lineHeight -
					(definition.bubble.anchor.Y === "Down"
						? (rows - 1) * V.readableLineHeight
						: 0),
			);
		}
	}
}
