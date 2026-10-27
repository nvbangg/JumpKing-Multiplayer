import data from "../../../../common/adventure.json";
import { required } from "../../required";
import { PHYSICS as P } from "./tuning";
import type { GameMap, PlayerInput, PlayerState, ReadView } from "./types";

export const ADVENTURE = data;
type Rect = { x: number; y: number; width: number; height: number };
export interface DialogueState {
	introduced: boolean;
	best: number;
	pool: string[];
	loop: number;
	flags: Record<string, number>;
	quote: string | null;
	line: number;
	ticks: number;
	wait: number;
	busy: number;
	talks: number;
}
export interface ReadableState {
	wait: number;
	line: number;
	ticks: number;
	done: boolean;
}
export interface AdventureState {
	codecVersion: 2;
	flags: string[];
	dialogue: Record<string, DialogueState>;
	readables: Record<string, ReadableState>;
	raven: RavenState;
	whiteRaven: RavenState;
}
export interface RavenState {
	index: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	flying: boolean;
	ticks: number;
	done: boolean;
}
export interface AdventureEvent {
	type: "SPEECH" | "FLEE";
	id: string;
}
const T = data.tuning;
const overlap = (a: Rect, b: Rect) =>
	a.x < b.x + b.width &&
	a.x + a.width > b.x &&
	a.y < b.y + b.height &&
	a.y + a.height > b.y;
const box = (s: PlayerState): Rect => ({
	x: Math.trunc(s.x),
	y: Math.trunc(s.y),
	width: P.bodyWidth,
	height: P.bodyHeight,
});
const freshReadable = (): ReadableState => ({
	wait: 0,
	line: 0,
	ticks: 0,
	done: false,
});
type Bird = "raven" | "whiteRaven";
const BIRDS: Bird[] = ["raven", "whiteRaven"];
const freshRaven = (height: number, bird: Bird): RavenState => {
	const first = required(data[bird].positions[0]);
	return {
		index: 0,
		x: first.x,
		y: first.y - first.screen * height,
		vx: 0,
		vy: 0,
		flying: false,
		ticks: 0,
		done: false,
	};
};

export class Adventure {
	private state: AdventureState;
	constructor(readonly map: GameMap) {
		this.state = {
			codecVersion: 2,
			flags: [],
			dialogue: {},
			readables: {},
			raven: freshRaven(map.screenHeight, "raven"),
			whiteRaven: freshRaven(map.screenHeight, "whiteRaven"),
		};
		for (const npc of data.npcs)
			this.state.dialogue[npc.id] = {
				introduced: !npc.introLengths.length,
				best: 0,
				pool: [],
				loop: 0,
				flags: {},
				quote: null,
				line: 0,
				ticks: 0,
				wait: 0,
				busy: 0,
				talks: 0,
			};
		for (const readable of data.readables)
			this.state.readables[readable.id] = freshReadable();
	}
	view(): ReadView<AdventureState> {
		return this.state;
	}
	snapshot(): AdventureState {
		return structuredClone(this.state);
	}
	get completed(): boolean {
		return this.state.flags.includes("CompletedNormalGame");
	}
	get ravenDone(): boolean {
		return this.state.raven.done;
	}
	private tickRaven(
		bird: Bird,
		player: PlayerState,
		events: AdventureEvent[],
	): void {
		const s = this.state[bird],
			positions = data[bird].positions,
			pos = required(positions[s.index]);
		if (s.done) return;
		if (
			!s.flying &&
			player.screen === pos.screen &&
			(Math.trunc(player.x) + P.bodyWidth / 2 - s.x) ** 2 +
				(Math.trunc(player.y) + P.bodyHeight / 2 - s.y) ** 2 <
				data.raven.triggerRadius ** 2
		) {
			s.flying = true;
			s.ticks = 0;
			s.vy = data.raven.launchVelocityY;
			s.vx = 0;
			events.push({ type: "FLEE", id: bird });
		}
		if (!s.flying) return;
		s.ticks++;
		if (s.ticks % data.raven.accelerationTicks === 0) {
			s.vx += pos.flyDirection * data.raven.accelerationX;
			s.vy *= data.raven.velocityGrowthY;
		}
		s.x += s.vx * data.raven.motionScale;
		s.y += s.vy * data.raven.motionScale;
		const localY = s.y + pos.screen * this.map.screenHeight;
		if (
			s.x < 0 ||
			s.x >= this.map.width ||
			localY < 0 ||
			localY >= this.map.screenHeight
		) {
			s.index++;
			if (s.index >= positions.length) {
				s.done = true;
				s.index = positions.length - 1;
			}
			s.flying = false;
			const next = required(positions[s.index]);
			s.x = next.x;
			s.y = next.y - next.screen * this.map.screenHeight;
		}
	}
	private worldRect(rect: Rect, screen: number): Rect {
		return { ...rect, y: rect.y - screen * this.map.screenHeight };
	}
	complete(): void {
		if (!this.completed) this.state.flags.push("CompletedNormalGame");
	}
	quoteLengths(id: string, quote: string): number[] {
		const npc = data.npcs.find((value) => value.id === id);
		if (!npc) return [];
		const parts = quote.split(":");
		if (quote === "intro") return npc.introLengths;
		if (parts[0] === "progress")
			return npc.progressQuotes[Number(parts[1])]?.lineLengths || [];
		if (parts[0] === "loop") return npc.loopLengths[Number(parts[1])] || [];
		if (parts[0] === "flag")
			return (
				npc.flagQuotes[Number(parts[1])]?.sequences[Number(parts[2])] || []
			);
		return [];
	}
	tick(player: PlayerState, input: PlayerInput): AdventureEvent[] {
		const events: AdventureEvent[] = [],
			hitbox = box(player);
		for (const npc of data.npcs) {
			const s = required(this.state.dialogue[npc.id]);
			const quotes = npc.progressQuotes
				.map((quote, i) => ({ ...quote, i }))
				.filter((quote) => quote.screen === player.screen + 1);
			if (quotes.length && player.screen + 1 > s.best) {
				s.best = player.screen + 1;
				s.pool.push(...quotes.map((quote) => `progress:${quote.i}`).reverse());
			}
			if (s.busy > 0) {
				s.busy--;
				continue;
			}
			if (s.quote !== null) {
				const lengths = this.quoteLengths(npc.id, s.quote);
				if (
					++s.ticks >=
					required(lengths[s.line]) * npc.characterSeconds * P.tickRate +
						T.speechHoldTicks
				) {
					s.ticks = 0;
					if (++s.line >= lengths.length) {
						s.quote = null;
						s.line = 0;
						s.busy = T.npcBusyTicks;
					}
				}
				continue;
			}
			s.wait = overlap(hitbox, this.worldRect(npc.trigger, npc.screen))
				? s.wait + 1
				: 0;
			if (s.wait < npc.delayTicks) continue;
			s.wait = 0;
			const flagged = npc.flagQuotes.findIndex(
				(quote) =>
					this.state.flags.includes(quote.flag) &&
					(s.flags[quote.flag] || 0) < quote.sequences.length,
			);
			let consumed = true;
			if (flagged >= 0) {
				const flag = required(npc.flagQuotes[flagged]).flag,
					index = s.flags[flag] || 0;
				s.quote = `flag:${flagged}:${index}`;
				s.flags[flag] = index + 1;
				s.introduced = true;
			} else if (!s.introduced) {
				s.quote = "intro";
				s.introduced = true;
			} else if (s.pool.length) s.quote = required(s.pool.pop());
			else {
				s.quote = npc.loopLengths.length
					? `loop:${s.loop % npc.loopLengths.length}`
					: null;
				s.loop++;
				consumed = false;
			}
			if (consumed && s.quote !== null) s.talks++;
		}
		for (const readable of data.readables) {
			const s = required(this.state.readables[readable.id]);
			if (!overlap(hitbox, this.worldRect(readable.trigger, readable.screen))) {
				if (s.wait !== 0 || s.line !== 0 || s.ticks !== 0 || s.done) {
					s.wait = s.line = s.ticks = 0;
					s.done = false;
				}
				continue;
			}
			if (s.done) continue;
			if (s.wait < T.readableWaitTicks) {
				s.wait = input.left !== input.right || input.jump ? 0 : s.wait + 1;
				continue;
			}
			s.ticks++;
			const length = required(readable.lineLengths[s.line]);
			if (
				s.ticks % T.readableCharacterTicks === 0 &&
				s.ticks <= length * T.readableCharacterTicks
			)
				events.push({ type: "SPEECH", id: readable.id });
			if (s.ticks >= length * T.readableCharacterTicks + T.speechHoldTicks) {
				s.ticks = 0;
				if (s.line + 1 < readable.lineLengths.length) s.line++;
				else s.done = true;
			}
		}
		for (const bird of BIRDS) this.tickRaven(bird, player, events);
		return events;
	}
	restore(value: unknown): void {
		this.prepareRestore(value)();
	}

	prepareRestore(value: unknown): () => void {
		if (!value || typeof value !== "object")
			throw new Error("Invalid adventure snapshot");
		const saved = value as AdventureState;
		const count = (n: unknown) =>
			Number.isSafeInteger(n) &&
			(n as number) >= 0 &&
			(n as number) <= T.maxCounter;
		if (
			saved.codecVersion !== 2 ||
			!Array.isArray(saved.flags) ||
			new Set(saved.flags).size !== saved.flags.length ||
			saved.flags.some((flag) => flag !== "CompletedNormalGame")
		)
			throw new Error("Invalid adventure snapshot");
		for (const definition of data.npcs) {
			const s = saved.dialogue?.[definition.id];
			if (
				!s ||
				typeof s.introduced !== "boolean" ||
				[s.best, s.loop, s.line, s.ticks, s.wait, s.busy, s.talks].some(
					(value) => !count(value),
				) ||
				!Array.isArray(s.pool) ||
				s.pool.some(
					(quote) => !this.quoteLengths(definition.id, quote).length,
				) ||
				(s.quote !== null &&
					(!this.quoteLengths(definition.id, s.quote).length ||
						s.line >= this.quoteLengths(definition.id, s.quote).length)) ||
				!s.flags ||
				typeof s.flags !== "object" ||
				Array.isArray(s.flags) ||
				Object.entries(s.flags).some(
					([flag, value]) =>
						!definition.flagQuotes.some((quote) => quote.flag === flag) ||
						!count(value),
				)
			)
				throw new Error("Invalid dialogue snapshot");
		}
		for (const definition of data.readables) {
			const s = saved.readables?.[definition.id];
			if (
				!s ||
				[s.wait, s.line, s.ticks].some((value) => !count(value)) ||
				s.wait > T.readableWaitTicks ||
				s.line >= definition.lineLengths.length ||
				typeof s.done !== "boolean"
			)
				throw new Error("Invalid readable snapshot");
		}
		for (const bird of BIRDS) {
			const raven = saved[bird];
			if (
				!raven ||
				!count(raven.index) ||
				raven.index >= data[bird].positions.length ||
				!count(raven.ticks) ||
				typeof raven.flying !== "boolean" ||
				typeof raven.done !== "boolean" ||
				[raven.x, raven.y, raven.vx, raven.vy].some(
					(value) => !Number.isFinite(value) || Math.abs(value) > T.maxCounter,
				) ||
				(raven.done &&
					(raven.index !== data[bird].positions.length - 1 || raven.flying))
			)
				throw new Error("Invalid raven snapshot");
		}
		const restored: AdventureState = structuredClone({
			codecVersion: 2,
			flags: saved.flags,
			dialogue: saved.dialogue,
			readables: saved.readables,
			raven: saved.raven,
			whiteRaven: saved.whiteRaven,
		});
		return () => {
			this.state = restored;
		};
	}
}
