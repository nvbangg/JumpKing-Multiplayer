import { expect, test } from "@playwright/test";
import {
	createRoom,
	joinRoom,
	leaveOnline,
	observeOnline,
	registerOnline,
	startRoom,
} from "./support/online";

test.skip(
	process.env.E2E_ROOM_PAUSE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);

test("Private rooms accept IDs and host pause keeps every player in the game menu", async ({
	browser,
}, info) => {
	const first = await browser.newContext(),
		second = await browser.newContext();
	try {
		for (const context of [first, second])
			await context.addInitScript(() =>
				localStorage.setItem(
					"jumpking.options",
					JSON.stringify({ sound: false }),
				),
			);
		const host = await first.newPage(),
			peer = await second.newPage();
		const errors: string[] = [];
		for (const page of [host, peer])
			page.on("pageerror", (error) => errors.push(error.message));
		const hostState = observeOnline(host),
			peerState = observeOnline(peer);
		const hostName = await registerOnline(host, "pause_host");
		await registerOnline(peer, "pause_peer");
		const id = await createRoom(host);
		await host
			.getByLabel("Visibility", { exact: true })
			.selectOption("PRIVATE");
		await expect(host.getByLabel("Visibility", { exact: true })).toHaveValue(
			"PRIVATE",
		);
		const listed = (await (await peer.request.get("/api/rooms")).json()).rooms;
		expect(listed.some((room: { roomId: string }) => room.roomId === id)).toBe(
			false,
		);
		expect(
			(await (await peer.request.get(`/api/rooms/${id}`)).json()).joinable,
		).toBe(true);
		await joinRoom(peer, id);
		await expect(peer.getByLabel("Visibility", { exact: true })).toHaveValue(
			"PRIVATE",
		);
		await peer.evaluate(async () => {
			const path = "/src/network/GameSocket.ts";
			const { GameSocket } = await import(path);
			const original = GameSocket.prototype.input;
			GameSocket.prototype.input = function (
				type: "PLAYER_INPUT" | "CANCEL_INPUT",
				payload: Record<string, unknown>,
			) {
				Object.assign(window, {
					interruptPausedPeer: () =>
						this.fail("Test reconnect during Host Pause"),
				});
				original.call(this, type, payload);
			};
		});
		await startRoom(host, peer);
		await host.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await host.screenshot({ path: info.outputPath("host-menu.png") });
		await host
			.getByRole("button", { name: "Pause Match", exact: true })
			.click();
		for (const page of [host, peer]) {
			await expect(page).toHaveTitle(/JumpKing/);
			await expect(page.locator("vite-error-overlay")).toHaveCount(0);
			await expect(
				page.getByRole("heading", { name: "Match Paused", exact: true }),
			).toBeVisible();
			await expect(page.locator("canvas")).toHaveCount(1);
			await expect(page.locator(".lobby-panel")).toHaveCount(0);
		}
		await host.screenshot({ path: info.outputPath("host-paused.png") });
		await peer.screenshot({ path: info.outputPath("peer-paused.png") });
		await expect(
			peer.getByRole("button", { name: "Resume", exact: true }),
		).toHaveCount(0);
		await expect(
			peer.getByRole("status").filter({ hasText: "Match is paused by Host" }),
		).toBeVisible();
		await expect.poll(() => hostState.snapshot?.self.paused).toBe(true);
		await expect.poll(() => peerState.snapshot?.self.paused).toBe(true);
		const generation = peerState.snapshot?.generation ?? 0;
		await peer.evaluate(() =>
			(
				window as unknown as { interruptPausedPeer: () => void }
			).interruptPausedPeer(),
		);
		await expect
			.poll(() => peerState.snapshot?.generation ?? 0)
			.toBeGreaterThan(generation);
		await expect(
			peer.getByRole("heading", { name: "Disconnected", exact: true }),
		).toHaveCount(0);
		await expect(
			peer.getByRole("heading", { name: "Match Paused", exact: true }),
		).toBeVisible();
		await expect.poll(() => peerState.snapshot?.self.paused).toBe(true);
		const pausedTick = peerState.snapshot?.serverTick;
		await peer.keyboard.press("ArrowRight");
		await peer.waitForTimeout(400);
		expect(peerState.snapshot?.serverTick).toBe(pausedTick);
		await host
			.getByRole("button", { name: "Resume Match", exact: true })
			.click();
		for (const page of [host, peer])
			await expect(
				page.getByRole("region", { name: "Game menu", exact: true }),
				page === host
					? "Host menu after Resume Match"
					: "Peer menu after Resume Match",
			).toHaveCount(0);
		await expect.poll(() => peerState.snapshot?.self.paused).toBe(false);
		await expect
			.poll(() => peerState.snapshot?.serverTick ?? 0)
			.toBeGreaterThan(pausedTick ?? 0);
		await peer
			.getByRole("button", { name: `Watch ${hostName}`, exact: true })
			.click();
		await expect(
			peer.getByRole("button", { name: "Back to My Game", exact: true }),
		).toBeVisible();
		await host.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await host
			.getByRole("button", { name: "Pause Match", exact: true })
			.click();
		await expect(
			peer.getByRole("heading", { name: "Match Paused", exact: true }),
		).toBeVisible();
		await host
			.getByRole("button", { name: "Resume Match", exact: true })
			.click();
		await expect(
			peer.getByRole("region", { name: "Game menu", exact: true }),
		).toHaveCount(0);
		await expect(
			peer.getByRole("button", { name: "Back to My Game", exact: true }),
		).toBeVisible();
		expect(errors).toEqual([]);
	} finally {
		for (const context of [first, second]) {
			for (const page of context.pages()) await leaveOnline(page);
			await context.close();
		}
	}
});
