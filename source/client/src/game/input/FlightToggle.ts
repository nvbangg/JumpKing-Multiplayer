import { PHYSICS } from "../simulation/tuning";

export class FlightToggle {
	private previousPress: number | null = null;
	constructor(
		readonly allowed: boolean,
		private isFlying: () => boolean,
		private setFlight: (enabled: boolean) => void,
	) {}
	press(now: number): void {
		if (!this.allowed || !Number.isFinite(now)) return;
		if (
			this.previousPress !== null &&
			now >= this.previousPress &&
			now - this.previousPress <= PHYSICS.flyDoubleTapMs
		) {
			this.previousPress = null;
			this.setFlight(!this.isFlying());
		} else this.previousPress = now;
	}
	cancel(): void {
		this.previousPress = null;
	}
}
