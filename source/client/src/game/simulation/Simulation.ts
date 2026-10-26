import { required } from "../../required";
import { type FinishPlatform, findFinishPlatform } from "./finishPlatform";
import { PHYSICS as P } from "./tuning";
import type {
	GameMap,
	MovementEffect,
	PlayerInput,
	PlayerState,
} from "./types";

const f = Math.fround;
const clamp = (value: number, low: number, high: number) =>
	Math.max(low, Math.min(high, value));
const towards = (value: number, target: number, amount: number) =>
	value + clamp(target - value, -amount, amount);
interface Contact {
	solid: boolean;
	slope: string;
	ice: boolean;
	snow: boolean;
}

export class Simulation {
	private state: PlayerState;
	readonly finishPlatform: FinishPlatform | undefined;
	constructor(
		readonly map: GameMap,
		readonly flyAllowed = false,
		readonly noWalk = false,
	) {
		this.finishPlatform =
			(map.finish.minProgress ?? 0) > 0 ? findFinishPlatform(map) : undefined;
		this.state = this.initialState();
	}

	private initialState(): PlayerState {
		return {
			codecVersion: 1,
			...this.map.spawn,
			vx: 0,
			vy: 1,
			grounded: true,
			charge: 0,
			direction: 1,
			prevJump: false,
			jumpConsumed: false,
			directions: [],
			splat: 0,
			knocked: false,
			ice: false,
			snow: false,
			wind: false,
			screen: this.screenAt(this.map.spawn.y + P.bodyHeight / 2),
			ticks: 0,
			jumps: 0,
			falls: 0,
			airChargeTicks: 0,
			bumpCooldownTicks: 0,
			freeFlight: false,
			phasingFall: false,
		};
	}

	snapshot(): PlayerState {
		const result = { ...this.state, directions: [...this.state.directions] };
		if (!result.slipping) delete result.slipping;
		if (!result.jumpBoost) delete result.jumpBoost;
		return result;
	}

	get y(): number {
		return this.state.y;
	}

	restore(state: PlayerState): void {
		this.prepareRestore(state)();
	}

	prepareRestore(state: PlayerState): () => void {
		if (
			state.codecVersion !== 1 ||
			!Array.isArray(state.directions) ||
			state.directions.length > P.directionBuffer ||
			state.directions.some((value) => ![-1, 0, 1].includes(value))
		)
			throw new Error("Invalid simulation snapshot");
		const booleans = [
			"grounded",
			"prevJump",
			"jumpConsumed",
			"knocked",
			"ice",
			"snow",
			"wind",
			"freeFlight",
			"phasingFall",
		] as const;
		const integers = [
			"ticks",
			"jumps",
			"falls",
			"charge",
			"splat",
			"screen",
			"airChargeTicks",
			"bumpCooldownTicks",
		] as const;
		if (
			booleans.some((key) => typeof state[key] !== "boolean") ||
			integers.some(
				(key) => !Number.isSafeInteger(state[key]) || state[key] < 0,
			) ||
			["x", "y", "vx", "vy"].some(
				(key) =>
					typeof state[key as keyof PlayerState] !== "number" ||
					!Number.isFinite(state[key as keyof PlayerState]),
			) ||
			![-1, 1].includes(state.direction) ||
			state.screen >= this.map.screens.length ||
			state.charge > P.chargeTicks ||
			state.splat > P.splatTicks ||
			(state.slipping !== undefined && typeof state.slipping !== "boolean") ||
			(state.jumpBoost !== undefined && typeof state.jumpBoost !== "boolean") ||
			state.x < -P.bodyWidth / 2 ||
			state.x > this.map.width - P.bodyWidth / 2 ||
			state.y < -this.map.screenHeight * this.map.screens.length ||
			state.y > this.map.screenHeight
		)
			throw new Error("Invalid simulation snapshot");
		const restored = { ...state, directions: [...state.directions] };
		return () => {
			this.state = restored;
			if (!this.flyAllowed && this.state.freeFlight) this.setFlight(false);
		};
	}

	cancelInput(): void {
		const s = this.state;
		s.charge = 0;
		s.directions = [];
		s.airChargeTicks = 0;
		s.prevJump = false;
		s.jumpConsumed = true;
	}

	boostJump(): void {
		this.state.jumpBoost = true;
	}

	respawn(): void {
		const { ticks, jumps, falls, jumpBoost } = this.state;
		this.state = { ...this.initialState(), ticks, jumps, falls, jumpBoost };
	}

	respawnAt(x: number, y: number, countFall = false): void {
		this.respawn();
		if (countFall) this.state.falls++;
		this.state.x = x;
		this.state.y = y;
		this.state.screen = this.screenAt(y + P.bodyHeight / 2);
		this.state.vy = 0;
		this.cancelInput();
	}

	setFlight(enabled: boolean): void {
		if (enabled && !this.flyAllowed) throw new Error("Fly mode is disabled");
		if (this.state.freeFlight === enabled) return;
		const s = this.state;
		s.freeFlight = enabled;
		s.vx = 0;
		s.vy = 0;
		s.grounded = false;
		s.phasingFall = !enabled && this.contact().solid;
		s.splat = 0;
		delete s.slipping;
		s.knocked = false;
		s.ice = false;
		s.snow = false;
		s.wind = false;
		this.cancelInput();
	}

	get progress(): number {
		return Math.max(0, this.map.progressOriginY - this.state.y - P.bodyHeight);
	}
	get finished(): boolean {
		return (
			this.state.screen === this.map.finish.screen &&
			this.state.grounded &&
			this.state.x + P.bodyWidth / 2 >= this.map.finish.minCenterX &&
			this.state.x + P.bodyWidth / 2 <=
				(this.map.finish.maxCenterX ?? Infinity) &&
			this.progress >= (this.map.finish.minProgress ?? 0) &&
			(!(this.map.finish.minProgress ?? 0) ||
				(!!this.finishPlatform &&
					this.state.y + P.bodyHeight === this.finishPlatform.y &&
					this.state.x + P.bodyWidth > this.finishPlatform.x &&
					this.state.x < this.finishPlatform.x + this.finishPlatform.width))
		);
	}

	private screenAt(y: number): number {
		return clamp(
			-Math.floor(y / this.map.screenHeight),
			0,
			this.map.screens.length - 1,
		);
	}

	private contact(): Contact {
		const x = Math.trunc(this.state.x),
			y = Math.trunc(this.state.y);
		const right = x + P.bodyWidth,
			bottom = y + P.bodyHeight,
			size = this.map.tileSize;
		const info: Contact = { solid: false, slope: "", ice: false, snow: false };
		let nearest = Infinity,
			solidTop = Infinity,
			slopeTop = Infinity;
		const rows = this.map.screenHeight / size;
		for (
			let ty = Math.floor(y / size);
			ty <= Math.floor((bottom - 1) / size);
			ty++
		) {
			const screenIndex = -Math.floor(ty / rows);
			const screen = this.map.screens[screenIndex];
			if (!screen) continue;
			const row = required(screen.tiles[ty + screenIndex * rows]);
			for (
				let tx = Math.max(0, Math.floor(x / size));
				tx <=
				Math.min(this.map.width / size - 1, Math.floor((right - 1) / size));
				tx++
			) {
				const code = required(row[tx]),
					px = tx * size,
					py = ty * size;
				if (code === " ") continue;
				const left = Math.max(x, px) - px,
					top = Math.max(y, py) - py;
				const r = Math.min(right, px + size) - px,
					b = Math.min(bottom, py + size) - py;
				if (
					(code === "a" && r + b < size) ||
					(code === "b" && b < left) ||
					(code === "c" && top > r) ||
					(code === "d" && left + top > size)
				)
					continue;
				info.solid = true;
				info.ice ||= code === "I";
				info.snow ||= code === "N";
				if ("abcd".includes(code)) {
					slopeTop = Math.min(slopeTop, py);
					const distance = Math.abs(px + size / 2 - (x + P.bodyWidth / 2));
					if (distance <= nearest) {
						nearest = distance;
						info.slope = code;
					}
				} else solidTop = Math.min(solidTop, py);
			}
		}
		if (solidTop <= slopeTop && (info.slope === "a" || info.slope === "b"))
			info.slope = "";
		return info;
	}

	private projectSlope(code: string): boolean {
		const s = this.state;
		const nx = code === "a" || code === "c" ? -Math.SQRT1_2 : Math.SQRT1_2;
		const ny = code === "a" || code === "b" ? -Math.SQRT1_2 : Math.SQRT1_2;
		const dot = s.vx * nx + s.vy * ny;
		if (dot < 0) {
			s.vx = f(s.vx - dot * nx);
			s.vy = f(s.vy - dot * ny);
		}
		return dot < 0;
	}

	private move(): boolean {
		const s = this.state;
		let info = this.contact();
		if (!required(this.map.screens[s.screen]).wind) s.wind = false;
		else if (s.grounded) s.wind = true;
		if (s.wind && !s.snow && !s.slipping) {
			const phase = (s.ticks / P.tickRate) * P.windFrequency;
			s.vx = f(
				s.vx +
					clamp(2 * Math.sin(phase) + (Math.cos(phase) > 0 ? 1 : -1), -1, 1) *
						P.windAcceleration,
			);
		}
		const vx = s.vx,
			vy = s.vy,
			wasGrounded = s.grounded;
		if (info.solid) {
			s.x = f(s.x + vx);
			s.y = f(s.y + vy);
			return false;
		}
		let sideSlope = false,
			bumped = false;
		s.x = clamp(
			f(s.x + vx),
			-P.bodyWidth / 2,
			this.map.width - P.bodyWidth / 2,
		);
		info = this.contact();
		if (info.solid) {
			s.x = Math.trunc(s.x);
			const sign = vx > 0 ? 1 : -1;
			for (let attempts = 0; attempts < P.collisionRecoveryLimit; attempts++) {
				const next = this.contact();
				if (!next.solid) break;
				info = next;
				s.x -= sign;
			}
			if (!info.slope) {
				s.vx = f(-s.vx * P.bounce);
				s.knocked = true;
				bumped = true;
			} else {
				sideSlope = true;
				if (wasGrounded && Math.abs(vx) <= P.walkSpeed && vy > 0) s.vx = 0;
				else this.projectSlope(info.slope);
			}
		}
		const signY = s.vy > 0 ? 1 : -1;
		s.y = f(s.y + s.vy);
		if (wasGrounded && s.vy > 0) s.y++;
		info = this.contact();
		s.snow = false;
		if (info.solid) {
			s.y = Math.trunc(s.y);
			for (let attempts = 0; attempts < P.collisionRecoveryLimit; attempts++) {
				const next = this.contact();
				if (!next.solid) break;
				info = next;
				s.y -= signY;
			}
			s.ice = info.ice;
			if (signY > 0) {
				s.grounded = !info.slope;
				if (info.slope) s.knocked = this.projectSlope(info.slope);
				else {
					s.knocked = false;
					s.snow = info.snow;
					if (vy === P.maxFall && s.splat === 0) {
						s.splat = P.splatTicks;
						s.falls++;
					}
				}
			} else {
				bumped = true;
				if (info.slope) this.projectSlope(info.slope);
				s.vx = f(s.vx * P.bounce);
			}
			if (!info.slope || s.vy <= 0 || s.grounded) s.vy = 0;
		} else {
			s.grounded = false;
			s.ice = false;
			if (sideSlope && signY > 0 && !s.knocked) {
				s.vx = f(-s.vx * P.bounce);
				s.knocked = true;
				bumped = true;
			}
		}
		s.vy = Math.min(f(s.vy + P.gravity), P.maxFall);
		if (s.ice && !s.slipping) s.vx = f(towards(s.vx, 0, P.iceFriction));
		return bumped;
	}

	tick(input: PlayerInput): MovementEffect[] {
		const s = this.state;
		if (input.freeFlight !== undefined && input.freeFlight !== s.freeFlight)
			this.setFlight(input.freeFlight);
		if (s.freeFlight) {
			s.vx = (Number(input.right) - Number(input.left)) * P.flyHorizontalSpeed;
			s.vy = (Number(!!input.down) - Number(!!input.up)) * P.flyVerticalSpeed;
			s.x = clamp(f(s.x + s.vx), 0, this.map.width - P.bodyWidth);
			s.y = clamp(
				f(s.y + s.vy),
				-(this.map.screens.length - 1) * this.map.screenHeight,
				this.map.screenHeight - P.bodyHeight,
			);
			if (s.vx) s.direction = Math.sign(s.vx);
			s.screen = this.screenAt(s.y + P.bodyHeight / 2);
			s.ticks++;
			return [];
		}
		if (s.phasingFall) {
			s.vx = 0;
			s.vy = Math.min(f(s.vy + P.gravity), P.maxFall);
			s.y = f(s.y + s.vy);
			s.ticks++;
			s.screen = this.screenAt(s.y + P.bodyHeight / 2);
			if (s.y >= this.map.screenHeight - P.bodyHeight) this.respawn();
			else if (!this.contact().solid) s.phasingFall = false;
			return [];
		}
		const jumps = s.jumps,
			falls = s.falls,
			grounded = s.grounded;
		const bumped = this.move();
		const boundary =
			(s.x <= -P.bodyWidth / 2 && s.vx < 0) ||
			(s.x >= this.map.width - P.bodyWidth / 2 && s.vx > 0);
		if (
			s.slipping &&
			(bumped || boundary || (!grounded && s.grounded) || s.splat > 0)
		) {
			delete s.slipping;
			if (s.grounded || boundary) s.vx = 0;
			this.cancelInput();
		}
		s.ticks++;
		const intent = Number(input.right) - Number(input.left);
		if (!input.jump) s.jumpConsumed = false;
		s.prevJump = input.jump;
		if (s.slipping) {
			s.charge = 0;
			s.directions = [];
			s.jumpConsumed = true;
		} else if (s.splat > 0) {
			if (!s.ice) s.vx = 0;
			if (s.grounded) s.splat--;
			if (s.splat === 0 && !intent && !input.jump) s.splat = 1;
			s.charge = 0;
		} else if (
			s.grounded ||
			(s.charge > 0 && s.airChargeTicks < P.airGraceTicks)
		) {
			s.airChargeTicks = s.grounded ? 0 : s.airChargeTicks + 1;
			if (s.charge > 0 || (input.jump && !s.jumpConsumed)) {
				s.directions.unshift(intent);
				s.directions.length = Math.min(s.directions.length, P.directionBuffer);
				if (!s.ice && s.grounded) s.vx = 0;
				s.charge++;
				if (s.charge >= P.chargeTicks || !input.jump) {
					let intensity = Math.min(1, s.charge / P.chargeTicks);
					const direction =
						intent || s.directions.find((value) => value !== 0) || 0;
					if (!s.snow || intensity > P.snowMinimumCharge) {
						if (s.snow && intensity < P.snowLaunchCharge)
							intensity = P.snowLaunchCharge;
						s.vy = f(
							P.jumpVelocity *
								intensity *
								(s.jumpBoost ? P.jumpBoostVelocityMultiplier : 1),
						);
						delete s.jumpBoost;
						s.vx = f(
							clamp(s.vx + direction * P.jumpSpeed, -P.jumpSpeed, P.jumpSpeed),
						);
						if (direction) s.direction = direction;
						s.jumps++;
					}
					s.charge = 0;
					s.directions = [];
					s.jumpConsumed = true;
				}
			} else {
				if (s.snow || (this.noWalk && !s.ice)) s.vx = 0;
				else if (!this.noWalk) {
					const target = intent * P.walkSpeed;
					if (!s.ice) s.vx = target;
					else if (
						intent &&
						(Math.sign(target) !== Math.sign(s.vx) ||
							Math.abs(target) > Math.abs(s.vx))
					)
						s.vx = f(towards(s.vx, target, P.iceAcceleration));
				}
				if (intent) s.direction = intent;
			}
		} else {
			s.charge = 0;
			s.directions = [];
			s.airChargeTicks = 0;
		}
		const next = this.screenAt(s.y + P.bodyHeight / 2);
		if (
			next !== s.screen &&
			s.vy !== 0 &&
			Math.sign(next - s.screen) === Math.sign(-s.vy) &&
			!(s.vy < 0 && Math.abs(s.vy) < P.cameraMinimumRiseSpeed)
		) {
			if (next < s.screen && required(this.map.screens[next]).wind)
				s.wind = true;
			s.screen = next;
		}
		const effects: MovementEffect[] = [];
		if (s.jumps > jumps) effects.push("JUMP");
		if (s.falls > falls) effects.push("SPLAT");
		else if (!grounded && s.grounded) effects.push("LAND");
		if (bumped) {
			if (s.bumpCooldownTicks === 0) effects.push("BUMP");
			s.bumpCooldownTicks = P.bumpQuietTicks;
		} else s.bumpCooldownTicks = Math.max(0, s.bumpCooldownTicks - 1);
		return effects;
	}
}
