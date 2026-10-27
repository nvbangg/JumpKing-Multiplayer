import { NETWORK } from "../../network/config";
import { required } from "../../required";
import type { OnlineSnapshot } from "./OnlineRuntime";

interface Sample {
	time: number;
	byId: Map<string, OnlineSnapshot["peers"][number]>;
}
export class PeerInterpolation {
	private samples: Sample[] = [];
	private offset = 0;
	private receivedAt = 0;
	private renderedAt = 0;
	private cursor: number | null = null;
	constructor(private tickRate: number) {}
	reset(): void {
		this.samples = [];
		this.cursor = null;
	}
	receive(value: OnlineSnapshot, now: number): void {
		const last = this.samples.at(-1);
		const time = (value.serverTick * 1000) / this.tickRate;
		if (last && time <= last.time) return;
		if (last && now - this.receivedAt > NETWORK.interpolationResetMs)
			this.reset();
		this.offset = this.samples.length
			? this.offset +
				(now - time - this.offset) * NETWORK.interpolationClockCorrection
			: now - time;
		this.receivedAt = now;
		const byId = new Map(value.peers.map((peer) => [peer.playerId, peer]));
		for (const [id, peer] of byId) {
			const old = last?.byId.get(id);
			if (
				old &&
				peer.positionRevision === old.positionRevision &&
				peer.state.screen === old.state.screen &&
				peer.state.ticks >= old.state.ticks &&
				peer.state.falls === old.state.falls
			)
				continue;
			// Neo riêng người vừa respawn/đổi screen; mẫu cũ không được kéo họ lùi lại.
			for (const sample of this.samples)
				if (sample.byId.has(id)) sample.byId.set(id, peer);
		}
		this.samples.push({ time, byId });
		if (this.samples.length > NETWORK.interpolationSnapshots)
			this.samples.shift();
	}
	frame(now: number): OnlineSnapshot["peers"] {
		const newest = this.samples.at(-1);
		if (!newest) return [];
		const target = now - this.offset - NETWORK.interpolationDelayMs;
		if (this.cursor === null) this.cursor = target;
		else {
			const elapsed = Math.max(0, now - this.renderedAt),
				expected = this.cursor + elapsed;
			// Hiệu chỉnh clock từ từ; packet đến dồn không được đặt lại vị trí đang vẽ.
			const limit = elapsed * NETWORK.interpolationClockCorrection;
			this.cursor =
				expected + Math.max(-limit, Math.min(limit, target - expected));
		}
		this.renderedAt = now;
		this.cursor = Math.min(this.cursor, newest.time);
		while (
			this.samples.length > 2 &&
			required(this.samples[1]).time <= this.cursor
		)
			this.samples.shift();
		const previous = required(this.samples[0]),
			current = this.samples[1] ?? previous;
		const alpha =
			current.time === previous.time
				? 1
				: Math.max(
						0,
						Math.min(
							1,
							(this.cursor - previous.time) / (current.time - previous.time),
						),
					);
		const oldPeers = previous.byId;
		const visible = newest.byId;
		return Array.from(current.byId.values())
			.filter((peer) => visible.has(peer.playerId))
			.map((peer) => {
				const old = oldPeers.get(peer.playerId);
				if (!old) return peer;
				return {
					...peer,
					state: {
						...peer.state,
						x: old.state.x + (peer.state.x - old.state.x) * alpha,
						y: old.state.y + (peer.state.y - old.state.y) * alpha,
					},
				};
			});
	}
}
