export type TutorialStep = "move" | "charge" | "jump";

const TUTORIAL_PREFIX = "jumpking.tutorial";

export function isTutorialCompleted(accountId?: string): boolean {
	try {
		const key = accountId ? `${TUTORIAL_PREFIX}.${accountId}` : TUTORIAL_PREFIX;
		return localStorage.getItem(key) === "true";
	} catch {
		return false;
	}
}

export function saveTutorialCompleted(accountId?: string): void {
	try {
		const key = accountId ? `${TUTORIAL_PREFIX}.${accountId}` : TUTORIAL_PREFIX;
		localStorage.setItem(key, "true");
	} catch {
		// Bỏ qua nếu localStorage bị chặn hoặc đầy
	}
}

export function nextTutorialStep(
	current: TutorialStep,
	state: {
		x: number;
		vx: number;
		charge: number;
		grounded: boolean;
		jumps: number;
		freeFlight?: boolean;
	},
	origin: { x: number; jumps: number },
): TutorialStep | null {
	if (state.freeFlight) return current;
	switch (current) {
		case "move":
			return state.grounded && Math.abs(state.x - origin.x) >= 8
				? "charge"
				: "move";
		case "charge":
			return state.charge >= 4 ? "jump" : "charge";
		case "jump":
			// Counter server xác nhận cú nhảy mới; rơi hoặc nhảy thẳng chưa hoàn tất bước này.
			return state.jumps > origin.jumps && !state.grounded && state.vx !== 0
				? null
				: "jump";
	}
}
