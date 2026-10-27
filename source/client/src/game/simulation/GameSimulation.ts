import { required } from "../../required";
import {
	ADVENTURE,
	Adventure,
	type AdventureEvent,
	type AdventureState,
} from "./Adventure";
import { Simulation } from "./Simulation";
import { PHYSICS as P } from "./tuning";
import type { GameMap, PlayerInput, PlayerState, ReadView } from "./types";

export interface WorldState {
	lastTick: number;
	safePosition?: { x: number; y: number };
	registeredScreens: number[];
	weatherWind: number;
	walls: Record<
		string,
		{ touching: boolean; canPlay: boolean; fadeTicks: number }
	>;
}
export interface GameSnapshot {
	codecVersion: 1;
	physics: PlayerState;
	adventure: AdventureState;
	world: WorldState;
}
export interface WorldEvent {
	type: "JINGLE" | "WALL";
	id: string;
}

export class GameSimulation {
	readonly physics: Simulation;
	readonly adventure: Adventure;
	private world: WorldState;
	constructor(
		readonly map: GameMap,
		flyAllowed = false,
		noWalk = false,
	) {
		this.physics = new Simulation(map, flyAllowed, noWalk);
		this.adventure = new Adventure(map);
		this.world = {
			lastTick: 0,
			registeredScreens: [],
			weatherWind: 0,
			walls: Object.fromEntries(
				ADVENTURE.walls.map((wall) => [
					wall.id,
					{
						touching: false,
						canPlay: true,
						fadeTicks: ADVENTURE.tuning.wallFadeTicks,
					},
				]),
			),
		};
	}
	view() {
		return {
			physics: this.physics.snapshot(),
			adventure: this.adventure.view(),
			world: this.world as ReadView<WorldState>,
		};
	}
	snapshot(): GameSnapshot {
		return {
			codecVersion: 1,
			physics: this.physics.snapshot(),
			adventure: this.adventure.snapshot(),
			world: structuredClone(this.world),
		};
	}
	get finished(): boolean {
		return this.physics.finished;
	}
	restore(saved: GameSnapshot): void {
		if (
			saved.codecVersion !== 1 ||
			!saved.world ||
			saved.world.lastTick !== saved.physics.ticks ||
			!Number.isFinite(saved.world.weatherWind) ||
			(saved.world.safePosition !== undefined &&
				(!saved.world.safePosition ||
					!Number.isFinite(saved.world.safePosition.x) ||
					!Number.isFinite(saved.world.safePosition.y) ||
					saved.world.safePosition.x < -P.bodyWidth / 2 ||
					saved.world.safePosition.x > this.map.width - P.bodyWidth / 2 ||
					saved.world.safePosition.y <
						-this.map.screenHeight * this.map.screens.length ||
					saved.world.safePosition.y > this.map.screenHeight)) ||
			!Array.isArray(saved.world.registeredScreens) ||
			new Set(saved.world.registeredScreens).size !==
				saved.world.registeredScreens.length ||
			saved.world.registeredScreens.some(
				(screen) =>
					!Number.isInteger(screen) ||
					screen < 0 ||
					screen >= this.map.screens.length,
			) ||
			ADVENTURE.walls.some((wall) => {
				const s = saved.world.walls?.[wall.id];
				return (
					!s ||
					typeof s.touching !== "boolean" ||
					typeof s.canPlay !== "boolean" ||
					!Number.isInteger(s.fadeTicks) ||
					s.fadeTicks < 0 ||
					s.fadeTicks > ADVENTURE.tuning.wallFadeTicks
				);
			})
		)
			throw new Error("Invalid world snapshot");
		// Chuẩn bị đủ ba phần trước khi ghi state, giữ restore nguyên vẹn nếu validation lỗi.
		const physics = this.physics.prepareRestore(saved.physics),
			adventure = this.adventure.prepareRestore(saved.adventure),
			world = structuredClone(saved.world);
		physics();
		adventure();
		this.world = world;
	}
	tick(input: PlayerInput, mode = "RACE") {
		const previousY = this.physics.y;
		const movement = this.physics.tick(input);
		let player = this.physics.snapshot();
		if (
			this.map.roomBottomY !== undefined &&
			(previousY > this.map.roomBottomY || player.y > this.map.roomBottomY)
		) {
			const alreadyFell = movement.includes("SPLAT");
			this.physics.respawnAt(this.map.spawn.x, this.map.spawn.y, !alreadyFell);
			if (!alreadyFell) movement.push("SPLAT");
			player = this.physics.snapshot();
		} else if (movement.includes("SPLAT")) {
			if (mode === "HARDCORE") this.physics.respawn();
			else if (mode === "EASY") {
				const safe = this.world.safePosition ?? this.map.spawn;
				this.physics.respawnAt(safe.x, safe.y);
			}
			if (mode === "HARDCORE" || mode === "EASY")
				player = this.physics.snapshot();
		} else if (
			mode === "EASY" &&
			player.grounded &&
			player.splat === 0 &&
			!player.freeFlight &&
			!player.phasingFall &&
			!player.slipping &&
			!player.knocked
		) {
			// Chỉ nhớ nền an toàn; không lấy vị trí tiếp đất của cú rơi SPLAT.
			this.world.safePosition ??= { x: player.x, y: player.y };
			this.world.safePosition.x = player.x;
			this.world.safePosition.y = player.y;
		}
		const events: WorldEvent[] = [];
		const adventure: AdventureEvent[] = this.adventure.tick(player, input);
		if (
			this.physics.finished &&
			this.map.finish.screen === this.map.screens.length - 1
		)
			this.adventure.complete();
		const phase = (player.ticks / P.tickRate) * P.windFrequency;
		const force =
			Math.max(
				-1,
				Math.min(1, 2 * Math.sin(phase) + (Math.cos(phase) > 0 ? 1 : -1)),
			) * P.windAcceleration;
		this.world.weatherWind = player.wind
			? this.world.weatherWind - (force * 2) / 3
			: 0;
		this.world.lastTick = player.ticks;
		if (
			player.grounded &&
			!this.world.registeredScreens.includes(player.screen)
		) {
			this.world.registeredScreens.push(player.screen);
			if (player.screen === this.map.finish.screen)
				events.push({ type: "JINGLE", id: "finish" });
		}
		for (const wall of ADVENTURE.walls) {
			const s = required(this.world.walls[wall.id]);
			const touching = wall.hitboxes.some(
				(rect) =>
					Math.trunc(player.x) < rect.x + rect.width &&
					Math.trunc(player.x) + P.bodyWidth > rect.x &&
					Math.trunc(player.y) < rect.y + rect.height &&
					Math.trunc(player.y) + P.bodyHeight > rect.y,
			);
			if (touching !== s.touching && touching && s.canPlay)
				events.push({ type: "WALL", id: wall.id });
			if (touching !== s.touching && !touching) s.canPlay = wall.everyTime;
			s.touching = touching;
			s.fadeTicks = Math.max(
				0,
				Math.min(
					ADVENTURE.tuning.wallFadeTicks,
					s.fadeTicks + (touching ? -1 : 1),
				),
			);
		}
		return { movement, adventure, world: events };
	}
}
