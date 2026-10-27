import raw from "../../../../common/physics.json";

const gravity = Math.fround(raw.gravityNumerator / raw.gravityDenominator);
export const PHYSICS = Object.freeze({
	...raw,
	gravity,
	jumpVelocity: -Math.fround(raw.jumpGravityMultiplier * gravity),
	jumpBoostVelocityMultiplier: Math.sqrt(raw.jumpBoostHeightMultiplier),
});
