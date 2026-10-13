import rules from "../../../../common/rules.json";
import { ApiError, api, backendOrigin } from "../../network/api";
import type { Identity } from "../../network/contracts";
import {
	acknowledgeSolo,
	pendingSoloRuns,
	rememberCrown,
	SOLO_SAVE_EVENT,
	type SoloRun,
} from "./storage";

const SYNC = Object.freeze({ batchSize: 5, rateBackoffMs: 60_000 });

export function soloMetrics(run: SoloRun) {
	return {
		revision: run.revision,
		status: run.status,
		playTicks: run.playTicks,
		jumps: run.jumps,
		falls: run.falls,
		currentProgress: run.currentProgress,
		maxProgress: run.maxProgress,
		peakReachedTicks: run.peakReachedTicks,
		finishTicks: run.finishTicks,
		startedAt: run.startedAt,
		endedAt: run.endedAt,
	};
}
export async function syncSolo(
	profile: string,
	accountId: string,
): Promise<number> {
	if (profile !== backendOrigin() + ":account:" + accountId)
		throw new ApiError("CONFLICT", "Solo profile does not match this account");
	const pending = (await pendingSoloRuns(profile))
		.sort(
			(a, b) =>
				Number(b.status === "FINISHED") - Number(a.status === "FINISHED") ||
				a.startedAt.localeCompare(b.startedAt) ||
				a.id.localeCompare(b.id),
		)
		.slice(0, SYNC.batchSize);
	if (!pending.length) return 0;
	const identity = await api<Identity>("/auth/me");
	if (!identity.authenticated || identity.account?.id !== accountId)
		throw new ApiError(
			"UNAUTHENTICATED",
			"Sign in again to sync this Solo profile",
		);
	if (identity.account.crownUnlocked) await rememberCrown(profile);
	for (const run of pending) {
		const ack = await api<{ revision: number; syncStatus: string }>(
			"/solo/runs/" + run.id,
			"PUT",
			soloMetrics(run),
			accountId,
		);
		if (ack.syncStatus !== "SAVED" || ack.revision !== run.revision)
			throw new ApiError(
				"PROTOCOL_ERROR",
				"The server returned an invalid Solo acknowledgement",
			);
		await acknowledgeSolo(profile, run.id, run.revision);
	}
	return pending.length;
}
export class SoloSync {
	private stopped = false;
	private busy = false;
	private urgent = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private nextAt = 0;
	private blockedUntil = 0;
	private readonly interval: ReturnType<typeof setInterval>;
	constructor(
		private profile: string,
		private accountId: string,
		private onProgress: () => void,
		private onError: (message: string) => void,
	) {
		this.interval = setInterval(() => this.request(), rules.soloSyncMs);
		window.addEventListener("online", this.online);
		window.addEventListener(SOLO_SAVE_EVENT, this.saved);
		this.request(true);
	}
	private online = () => this.request(true);
	private saved = (event: Event) => {
		const detail = (event as CustomEvent<{ profile: string; urgent: boolean }>)
			.detail;
		if (detail?.profile === this.profile) this.request(detail.urgent);
	};
	request(urgent = false): void {
		if (this.stopped) return;
		this.urgent ||= urgent;
		if (this.busy) return;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(
			() => {
				this.timer = null;
				void this.run();
			},
			Math.max(
				0,
				this.blockedUntil - Date.now(),
				this.urgent ? 0 : this.nextAt - Date.now(),
			),
		);
	}
	private async run(): Promise<void> {
		if (this.stopped || this.busy) return;
		this.busy = true;
		this.urgent = false;
		let changed = false;
		try {
			changed = (await syncSolo(this.profile, this.accountId)) > 0;
			if (!this.stopped) this.onError("");
		} catch (error) {
			if (!this.stopped)
				this.onError(
					error instanceof Error ? error.message : "Solo sync failed",
				);
			changed = true;
			if (error instanceof ApiError && error.code === "RATE_LIMIT")
				this.blockedUntil = Date.now() + SYNC.rateBackoffMs;
		} finally {
			this.busy = false;
			this.nextAt = Math.max(this.nextAt, Date.now() + rules.soloSyncMs);
			if (!this.stopped) {
				if (changed) this.onProgress();
				if (this.urgent) this.request(true);
			}
		}
	}
	stop(): void {
		this.stopped = true;
		clearInterval(this.interval);
		if (this.timer) clearTimeout(this.timer);
		window.removeEventListener("online", this.online);
		window.removeEventListener(SOLO_SAVE_EVENT, this.saved);
	}
}
