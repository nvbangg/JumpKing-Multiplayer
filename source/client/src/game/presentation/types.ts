import type { RoomItemsView } from "../items";
import type { AdventureState } from "../simulation/Adventure";
import type { FinishPlatform } from "../simulation/finishPlatform";
import type { WorldState } from "../simulation/GameSimulation";
import type { PlayerState } from "../simulation/types";

export type RenderPose = Pick<
	PlayerState,
	| "x"
	| "y"
	| "vx"
	| "vy"
	| "grounded"
	| "charge"
	| "direction"
	| "splat"
	| "slipping"
	| "knocked"
	| "ice"
	| "snow"
	| "wind"
	| "screen"
	| "ticks"
	| "jumps"
	| "falls"
>;
export interface RenderPlayer {
	id: string;
	nickname: string;
	color: string;
	state: RenderPose;
	crowned: boolean;
	adventure?: AdventureState;
}
export interface EndingSignal {
	id: string;
	screen: number;
	ravenDone?: boolean;
}
export interface PresentationHooks {
	onEndingStart?: (skip: () => void) => void;
	onEndingComplete?: () => void;
	onSound?: (key: string) => void;
}
export interface WorldFrame {
	self: RenderPlayer;
	peers: RenderPlayer[];
	world?: WorldState;
	items?: RoomItemsView;
	ending?: EndingSignal;
}
export interface GameRuntime {
	readonly finishMarker?: FinishPlatform;
	advance(deltaMs: number): void;
	frame(): WorldFrame;
}
