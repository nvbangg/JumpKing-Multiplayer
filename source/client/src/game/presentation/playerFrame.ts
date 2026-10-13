import type { RenderPose } from "./types";

export function playerFrame(state: RenderPose): string {
	if (state.splat > 0) return "splat";
	if (state.charge > 0) return "charge";
	if (!state.grounded)
		return state.knocked ? "bounce" : state.vy > 0 ? "fall" : "up";
	if (Math.abs(state.vx) <= 0.1 || state.snow) return "idle";
	const tick = state.ticks % 28;
	if (tick < 10) return "walk_one";
	if (tick < 14) return "walk_smear";
	return tick < 24 ? "walk_two" : "walk_smear";
}
