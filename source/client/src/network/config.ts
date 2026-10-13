export const NETWORK = Object.freeze({
	timeoutMs: 8000,
	heartbeatMs: 10000,
	maxPending: 64,
	maxMessageBytes: 16384,
	maxInputFrames: 180,
	maxChatCodePoints: 200,
	chatHistory: 50,
	interpolationDelayMs: 100,
	interpolationSnapshots: 12,
	interpolationResetMs: 1000,
	interpolationClockCorrection: 0.1,
	interpolationTeleportPixels: 96,
});
