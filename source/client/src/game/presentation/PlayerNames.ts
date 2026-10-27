import { PHYSICS } from "../simulation/tuning";
import { PRESENTATION as V } from "./config";
import type { RenderPlayer } from "./types";

export interface NameBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}
interface Label {
	element: HTMLSpanElement;
	width: number;
	height: number;
}

// Chữ HTML ở độ phân giải màn hình; không đi qua bộ lọc pixel của canvas gameplay.
export class PlayerNames {
	private layer = document.createElement("div");
	private labels = new Map<string, Label>();
	private scale = 1;
	private width: number = V.width;
	private height: number = V.height;
	private resized = true;
	private observer: ResizeObserver;

	constructor(parent: HTMLElement) {
		this.layer.className = "player-names";
		this.layer.setAttribute("aria-hidden", "true");
		parent.append(this.layer);
		this.observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const { width, height } = entry.contentRect;
			this.scale = Math.min(width / V.width, height / V.height);
			this.width = V.width * this.scale;
			this.height = V.height * this.scale;
			Object.assign(this.layer.style, {
				left: `${(width - this.width) / 2}px`,
				top: `${(height - this.height) / 2}px`,
				width: `${this.width}px`,
				height: `${this.height}px`,
				fontSize: `${Math.max(11, Math.min(18, V.nameFontSize * this.scale))}px`,
			});
			this.resized = true;
		});
		this.observer.observe(parent);
	}

	render(
		players: readonly RenderPlayer[],
		screen: number,
		obstacles: NameBounds[],
		hidden: boolean,
	) {
		this.layer.hidden = hidden;
		const present = new Set(players.map((player) => player.id));
		for (const [id, label] of this.labels)
			if (!present.has(id)) {
				label.element.remove();
				this.labels.delete(id);
			}
		if (hidden) return;
		const occupied = obstacles.map((box) => ({
			x: box.x * this.scale,
			y: (box.y + screen * V.height) * this.scale,
			width: box.width * this.scale,
			height: box.height * this.scale,
		}));
		const intersects = (a: NameBounds, b: NameBounds) =>
			a.x < b.x + b.width &&
			a.x + a.width > b.x &&
			a.y < b.y + b.height &&
			a.y + a.height > b.y;
		// Ưu tiên bản thân trước peers, giữ tên trong khung và tránh che hội thoại.
		for (const player of players) {
			let label = this.labels.get(player.id);
			if (!label) {
				const element = document.createElement("span");
				element.dataset.playerId = player.id;
				this.layer.append(element);
				label = { element, width: 0, height: 0 };
				this.labels.set(player.id, label);
			}
			const { element } = label;
			element.hidden = player.state.screen !== screen;
			if (element.hidden) continue;
			const changed = element.textContent !== player.nickname;
			if (changed) element.textContent = player.nickname;
			element.style.color = player.color;
			if (changed || this.resized || !label.width) {
				label.width = element.offsetWidth;
				label.height = element.offsetHeight;
			}
			const x = Math.max(
				0,
				Math.min(
					this.width - label.width,
					(player.state.x + PHYSICS.bodyWidth / 2) * this.scale -
						label.width / 2,
				),
			);
			const initial = Math.max(
				0,
				(player.state.y + screen * V.height - V.nameGap) * this.scale -
					label.height,
			);
			let found = false;
			for (let row = 0; row < 40; row++) {
				const offset =
					Math.ceil(row / 2) * (label.height + 3) * (row % 2 ? -1 : 1);
				const box = {
					x,
					y: initial + offset,
					width: label.width,
					height: label.height,
				};
				if (
					box.y < 0 ||
					box.y + box.height > this.height ||
					occupied.some((other) => intersects(box, other))
				)
					continue;
				element.style.transform = `translate(${box.x}px, ${box.y}px)`;
				occupied.push(box);
				found = true;
				break;
			}
			element.hidden = !found;
		}
		this.resized = false;
	}

	destroy() {
		this.observer.disconnect();
		this.layer.remove();
		this.labels.clear();
	}
}
