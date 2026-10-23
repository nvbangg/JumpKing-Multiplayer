import { PRESENTATION } from "../presentation/config";
import { NEUTRAL_INPUT, type PlayerInput } from "../simulation/types";

const relevant = new Set([
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"ArrowDown",
	"KeyA",
	"KeyD",
	"KeyW",
	"KeyS",
	"Space",
]);
export type TouchAction = "left" | "right" | "jump" | "up" | "down";
export class InputController {
	private keys = new Set<string>();
	private pointers = new Map<number, TouchAction>();
	private canceled = false;
	private padBlocked = false;
	private padUnavailable = false;
	private previousPad = { ...NEUTRAL_INPUT, menu: false };
	constructor(
		private onActivity: () => void,
		private onMenu: () => void,
		private onCancelInput: () => void = () => {},
		private onJumpPress: (now: number) => void = () => {},
	) {
		window.addEventListener("keydown", this.keyDown);
		window.addEventListener("keyup", this.keyUp);
	}
	private keyDown = (event: KeyboardEvent) => {
		if (event.defaultPrevented) return;
		if (
			event.target instanceof Element &&
			event.target.closest('input,textarea,select,[contenteditable="true"]')
		)
			return;
		if (event.code === "Escape" && !event.repeat) {
			this.onMenu();
			return;
		}
		if (!relevant.has(event.code)) return;
		event.preventDefault();
		if (!event.repeat && !this.keys.has(event.code)) {
			this.keys.add(event.code);
			this.onActivity();
			if (event.code === "Space" && !this.canceled)
				this.onJumpPress(performance.now());
		}
	};
	private keyUp = (event: KeyboardEvent) => {
		if (!relevant.has(event.code)) return;
		if (this.keys.delete(event.code)) this.onActivity();
	};
	pressPointer(id: number, action: TouchAction): void {
		if (this.canceled || this.pointers.has(id)) return;
		const freshJump =
			action === "jump" && ![...this.pointers.values()].includes("jump");
		this.pointers.set(id, action);
		this.onActivity();
		if (freshJump) this.onJumpPress(performance.now());
	}
	releasePointer(id: number): void {
		if (this.pointers.delete(id)) this.onActivity();
	}
	cancelPointer(id: number): void {
		if (!this.pointers.has(id)) return;
		this.pointers.clear();
		this.keys.clear();
		this.padBlocked = true;
		this.onCancelInput();
		this.onActivity();
	}
	private gamepad(): PlayerInput {
		if (this.padUnavailable) return { ...NEUTRAL_INPUT };
		let pads: (Gamepad | null)[];
		try {
			pads = Array.from(navigator.getGamepads?.() || []);
		} catch {
			this.padUnavailable = true;
			if (this.previousPad.jump) this.onCancelInput();
			return { ...NEUTRAL_INPUT };
		}
		const pad = pads.find((value) => value?.connected),
			axisX = pad?.axes[0] || 0,
			axisY = pad?.axes[1] || 0;
		if (!pad && this.previousPad.jump) this.onCancelInput();
		const pressed = (index: number) => pad?.buttons[index]?.pressed === true;
		const next = {
			left: pressed(14) || axisX < -PRESENTATION.gamepadDeadZone,
			right: pressed(15) || axisX > PRESENTATION.gamepadDeadZone,
			up: pressed(12) || axisY < -PRESENTATION.gamepadDeadZone,
			down: pressed(13) || axisY > PRESENTATION.gamepadDeadZone,
			jump: pressed(0),
			menu: pressed(9),
		};
		const changed = Object.keys(next).some(
			(key) =>
				next[key as keyof typeof next] !==
				this.previousPad[key as keyof typeof next],
		);
		const menuPressed = next.menu && !this.previousPad.menu;
		this.previousPad = next;
		if (changed) this.onActivity();
		if (menuPressed) this.onMenu();
		if (!Object.values(next).some(Boolean)) this.padBlocked = false;
		return this.padBlocked || this.canceled ? { ...NEUTRAL_INPUT } : next;
	}
	read(): PlayerInput {
		const pad = this.gamepad();
		if (this.canceled) return { ...NEUTRAL_INPUT };
		const k = this.keys,
			touch = new Set(this.pointers.values());
		return {
			left:
				k.has("KeyA") || k.has("ArrowLeft") || touch.has("left") || pad.left,
			right:
				k.has("KeyD") || k.has("ArrowRight") || touch.has("right") || pad.right,
			jump:
				k.has("Space") ||
				k.has("KeyW") ||
				k.has("ArrowUp") ||
				touch.has("jump") ||
				pad.jump,
			up: k.has("KeyW") || k.has("ArrowUp") || touch.has("up") || pad.up,
			down:
				k.has("KeyS") || k.has("ArrowDown") || touch.has("down") || pad.down,
		};
	}
	cancel(): void {
		this.keys.clear();
		this.pointers.clear();
		this.padBlocked = true;
		this.canceled = true;
	}
	resume(): void {
		this.keys.clear();
		this.pointers.clear();
		this.padBlocked = true;
		this.canceled = false;
		this.onActivity();
	}
	dispose(): void {
		window.removeEventListener("keydown", this.keyDown);
		window.removeEventListener("keyup", this.keyUp);
		this.keys.clear();
		this.pointers.clear();
	}
}
