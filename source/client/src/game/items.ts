export interface RoomItemSettings {
	itemCooldownMinutes: number | null;
}
export interface BananaTrap {
	id: number;
	x: number;
	y: number;
	armedAtTick: number;
}
export interface RockEffect {
	id: number;
	x: number;
	y: number;
	direction: number;
	tick: number;
}
export interface RoomItemsView {
	held: "BANANA" | "ROCK" | "BOOTS" | null;
	bananaArmed: boolean;
	cooldownMs: number;
	bananas: BananaTrap[];
	rocks: RockEffect[];
}
