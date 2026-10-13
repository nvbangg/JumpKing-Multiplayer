import { PHYSICS } from "../simulation/tuning";

export class FlightToggle {
	private enabled = false;
	private previousPress: number | null = null;
	constructor(
		readonly allowed: boolean,
		private isFlying: () => boolean,
		private setFlight: (enabled: boolean) => void,
	) {}
	setEnabled(enabled: boolean): void {
		this.enabled = this.allowed && enabled;
		this.cancel();
		if (!this.enabled && this.isFlying()) this.setFlight(false);
	}
	press(now: number): void {
		if (!this.enabled || !Number.isFinite(now)) return;
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
