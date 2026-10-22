export type TutorialStep = "move" | "charge" | "jump" | "completed";

const TUTORIAL_PREFIX = "jumpking.tutorial";

export function isTutorialCompleted(
	accountId?: string,
	totalJumps?: number,
): boolean {
	if (typeof totalJumps === "number" && totalJumps > 0) return true;
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
		charge: number;
		grounded: boolean;
		jumps: number;
		freeFlight?: boolean;
	},
	origin: { x: number; jumps: number },
): TutorialStep {
	if (state.freeFlight) return current;
	// Chỉ xác nhận cú nhảy thật từ counter server; rơi khỏi bệ không hoàn tất hướng dẫn.
	if (state.jumps > origin.jumps) return "completed";
	switch (current) {
		case "move":
			return state.grounded && Math.abs(state.x - origin.x) >= 8
				? "charge"
				: "move";
		case "charge":
			return state.charge >= 4 ? "jump" : "charge";
		case "jump":
			return "jump";
		case "completed":
			return "completed";
	}
}
