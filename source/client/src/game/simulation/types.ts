// View chỉ đọc trong frame hiện tại; snapshot riêng vẫn dùng cho restore/lưu dữ liệu.
export type ReadView<T> = { readonly [K in keyof T]: ReadView<T[K]> };

export interface GameMap {
	width: number;
	screenHeight: number;
	tileSize: number;
	progressOriginY: number;
	spawn: { x: number; y: number };
	roomBottomY?: number;
	finish: {
		screen: number;
		minCenterX: number;
		maxCenterX?: number;
		requiresGrounded: boolean;
		minProgress?: number;
	};
	screens: { tiles: string[]; wind: boolean }[];
}

export interface PlayerInput {
	left: boolean;
	right: boolean;
	jump: boolean;
	up?: boolean;
	down?: boolean;
	freeFlight?: boolean;
}

export interface PlayerState {
	codecVersion: 1;
	x: number;
	y: number;
	vx: number;
	vy: number;
	grounded: boolean;
	charge: number;
	direction: number;
	prevJump: boolean;
	jumpConsumed: boolean;
	directions: number[];
	splat: number;
	slipping?: boolean;
	jumpBoost?: boolean;
	knocked: boolean;
	ice: boolean;
	snow: boolean;
	wind: boolean;
	screen: number;
	ticks: number;
	jumps: number;
	falls: number;
	airChargeTicks: number;
	bumpCooldownTicks: number;
	freeFlight: boolean;
	phasingFall: boolean;
}

export type MovementEffect = "JUMP" | "LAND" | "SPLAT" | "BUMP";
export const NEUTRAL_INPUT: Readonly<PlayerInput> = Object.freeze({
	left: false,
	right: false,
	jump: false,
});
