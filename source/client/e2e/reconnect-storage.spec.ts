import { expect, test } from "@playwright/test";

test("reconnect context is stored per backend/identity and contains only the owner token fields", async ({
	page,
}) => {
	await page.goto("/");
	const result = await page.evaluate(async () => {
		const path = "/src/network/reconnect.ts",
			{ saveReconnect, loadReconnect, clearReconnect } = await import(path);
		const a = `${location.origin}:account:1`,
			b = `${location.origin}:account:2`,
			otherBackend = "http://127.0.0.1:9090:account:1";
		const context = {
			roomId: "001234",
			playerId: crypto.randomUUID(),
			reconnectToken: "x".repeat(43),
		};
		await saveReconnect(a, {
			...context,
			snapshot: { position: 99999 },
		});
		const saved = await loadReconnect(a),
			other = await loadReconnect(b),
			backend = await loadReconnect(otherBackend);
		let invalid = false;
		try {
			await saveReconnect(a, {
				...context,
				playerId: "------------------------------------",
			});
		} catch {
			invalid = true;
		}
		const invalidRoomIds = ["ABCDEF", "12345", "1234567", 123456];
		const rejectedRoomIds = [];
		for (const roomId of invalidRoomIds) {
			try {
				await saveReconnect(a, { ...context, roomId });
			} catch {
				rejectedRoomIds.push(roomId);
			}
		}
		await clearReconnect(b);
		const retained = await loadReconnect(a);
		await clearReconnect(a);
		return {
			context,
			saved,
			other,
			backend,
			invalid,
			invalidRoomIds,
			rejectedRoomIds,
			retained,
			cleared: await loadReconnect(a),
		};
	});
	expect(result.saved).toEqual(result.context);
	expect(result.retained).toEqual(result.context);
	expect(result.other).toBeNull();
	expect(result.backend).toBeNull();
	expect(result.cleared).toBeNull();
	expect(result.invalid).toBe(true);
	expect(result.rejectedRoomIds).toEqual(result.invalidRoomIds);
	await page.reload();
	expect(
		await page.evaluate(async () => {
			const path = "/src/network/reconnect.ts";
			return (await import(path)).loadReconnect(`${location.origin}:account:1`);
		}),
	).toBeNull();
});
