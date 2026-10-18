import { required } from "../../required";
import { PHYSICS as P } from "../simulation/tuning";

export interface EndingFrame {
	x: number;
	y: number;
	width: number;
	height: number;
	originX: number;
	originY: number;
}
export const ENDING_FRAMES: Record<string, EndingFrame> = {};
function grid(
	group: string,
	names: string,
	cells: string,
	width: number,
	height: number,
	x = 0,
	y = 0,
	originX = 0.5,
	originY = 1,
) {
	const positions = cells.split(" ");
	names.split(" ").forEach((name, i) => {
		const [column, row] = required(positions[i]).split(",").map(Number);
		ENDING_FRAMES[`${group}.${name}`] = {
			x: x + required(column) * width,
			y: y + required(row) * height,
			width,
			height,
			originX,
			originY,
		};
	});
}
grid(
	"regular",
	"idle walk_one walk_smear walk_two charge up fall bounce splat look_up",
	"0,0 1,0 2,0 3,0 0,1 1,1 2,1 0,2 3,1 0,3",
	48,
	48,
	224,
);
grid(
	"babe",
	"kiss idle0 idle1 idle2 charge up fall land",
	"2,0 3,0 4,0 5,0 5,1 4,1 3,1 2,1",
	32,
	32,
	0,
	0,
	0.5,
	0.5,
);
grid(
	"normal",
	"snatch idle_left idle_right charge walk_left0 walk_left1 walk_left2 walk_right0 walk_right1 walk_right2",
	"0,0 0,1 1,1 1,0 2,2 1,2 0,2 5,2 4,2 3,2",
	32,
	32,
);
ENDING_FRAMES["normal.snatch_smear"] = {
	x: 128,
	y: 96,
	width: 64,
	height: 32,
	originX: 0.5,
	originY: 1,
};
grid(
	"normal",
	"dunk parasol fly0 fly1 fly2 upskirt0 upskirt1 upskirt2",
	"1,1.5 0,1.5 0,2.5 1,2.5 2,2.5 0,3.5 1,3.5 2,3.5",
	64,
	64,
	0,
	0,
	0.5,
	0.5 + 16 / 96,
);
grid(
	"cherub",
	"deliver0 deliver1 escape0 escape1",
	"6,0 6,1 6,2 6,3",
	32,
	32,
	0,
	0,
	0.5,
	0.5,
);
export const endingFrameName = (frame: string) => `ending:${frame}`;
export function jumpStrength(height: number): number {
	let distance = 0,
		velocity = 0,
		ticks = 0;
	while (distance < height) {
		velocity = Math.fround(velocity + P.gravity);
		distance = Math.fround(distance + velocity);
		ticks++;
	}
	return Math.fround(-ticks * P.gravity);
}
export function jumpPath(
	velocity: number,
	stop: "ground" | "apex" | "fall" = "ground",
): number[] {
	const points = [0],
		ticks = Math.trunc(Math.abs(jumpStrength(78) / P.gravity));
	let last = 0;
	for (let i = 0; i < 300; i++) {
		if (stop !== "ground") {
			velocity = Math.fround(velocity + P.gravity);
			if (i >= ticks - 1) {
				points.push(last);
				break;
			}
		}
		const next = Math.fround(last + velocity);
		if (stop === "ground" && next >= 0 && i > 0) {
			points.push(last);
			break;
		}
		points.push(next);
		last = next;
		if (stop === "ground") velocity = Math.fround(velocity + P.gravity);
	}
	return points;
}
export const ENDING_PATHS = Object.freeze({
	babe: jumpPath(jumpStrength(15)),
	crownUp: jumpPath(jumpStrength(78), "apex"),
	crownDown: jumpPath(0, "fall"),
	full: Array.from({ length: 70 }, (_, i) =>
		Math.fround(jumpStrength(153) * i + (P.gravity * i * (i - 1)) / 2),
	),
});
