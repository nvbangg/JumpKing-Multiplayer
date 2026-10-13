import { expect, test } from "@playwright/test";

test("reconnect context is stored per backend/identity and contains only the owner token fields", async ({
	page,
}) => {
	await page.goto("/");
	const result = await page.evaluate(async () => {
		const path = "/src/network/reconnect.ts",
			{ saveReconnect, loadReconnect, clearReconnect } = await import(path);
		const a = location.origin + ":account:1",
			b = location.origin + ":account:2",
			otherBackend = "http://127.0.0.1:9090:account:1";
		const context = {
			roomId: "ABCDEF",
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
		await clearReconnect(b);
		const retained = await loadReconnect(a);
		await clearReconnect(a);
		return {
			context,
			saved,
			other,
			backend,
			invalid,
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
	await page.reload();
	expect(
		await page.evaluate(async () => {
			const path = "/src/network/reconnect.ts";
			return (await import(path)).loadReconnect(location.origin + ":account:1");
		}),
	).toBeNull();
});
