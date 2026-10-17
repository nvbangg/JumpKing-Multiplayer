export interface GameConfig {
	features: { flyEnabled: boolean };
}
export interface NetworkQuality {
	pingMs: number;
	avgPingMs: number;
	jitterMs: number;
	stalls: number;
	status: "good" | "fair" | "poor";
}
export interface Account {
	id: string;
	username: string;
	crownUnlocked: boolean;
}
export interface Identity {
	authenticated: boolean;
	account: Account | null;
}
export interface Statistics {
	totalPlayTimeMs: number;
	totalJumps: number;
	totalFalls: number;
	finishes: number;
	matchesPlayed: number;
	wins: number;
	bestFinishTimeMs: number | null;
}
export interface HistoryItem {
	id: string;
	kind: "COMMUNITY" | "ROOM";
	status: string;
	startedAt: string;
	endedAt: string;
	playTimeMs: number;
	jumps: number;
	falls: number;
	currentProgress: number;
	maxProgress: number;
	finishTimeMs: number | null;
	room: null | {
		mode: string;
		mapLevel: number;
		roomCode: string;
		durationMs: number;
		rank: number;
		isWinner: boolean;
	};
}
export interface LeaderboardEntry {
	id: string;
	rank: number;
	username: string;
	status: string;
	currentProgress: number;
	maxProgress: number;
	elapsedTimeMs: number;
	peakReachedTimeMs: number;
	finishTimeMs: number | null;
}
export interface PlayerStanding {
	playerId: string;
	nickname: string;
	colorSlot: number;
	rank: number;
	currentProgress: number;
}
export interface ChatMessage {
	id: string;
	playerId: string;
	nickname: string;
	text: string;
	sentAt: string;
	colorSlot: number;
}
