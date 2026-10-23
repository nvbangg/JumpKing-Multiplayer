import { expect, test } from "@playwright/test";
import { required } from "../src/required";
import { leaveOnline, observeOnline } from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);
test("committed Community Finish plays only for its owner and New Game clears the ending", async ({
	browser,
}, info) => {
	const first = await browser.newContext(),
		second = await browser.newContext();
	try {
		for (const context of [first, second])
			await context.addInitScript(() => {
				if (location.protocol.startsWith("http"))
					localStorage.setItem(
						"jumpking.options",
						JSON.stringify({ sound: false }),
					);
			});
		const winner = await first.newPage(),
			peer = await second.newPage(),
			winnerState = observeOnline(winner),
			peerState = observeOnline(peer),
			errors: string[] = [],
			finishEvents: Record<string, unknown>[] = [],
			peerFinishes: unknown[] = [];
		let peerDisconnected = false;
		for (const page of [winner, peer])
			page.on("pageerror", (error) => errors.push(error.message));
		winner.on("websocket", (socket) => {
			socket.on("framereceived", (frame) => {
				const message = JSON.parse(frame.payload.toString());
				if (message.type === "PLAYER_FINISHED")
					finishEvents.push(message.payload);
			});
		});
		peer.on("websocket", (socket) => {
			if (new URL(socket.url()).pathname !== "/ws/game") return;
			socket.on("close", () => {
				peerDisconnected = true;
			});
			socket.on("framereceived", (frame) => {
				const message = JSON.parse(frame.payload.toString());
				if (message.type === "PLAYER_FINISHED")
					peerFinishes.push(message.payload);
			});
		});
		const name = `ending_peer_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
		await peer.goto("/");
		await peer
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await peer.getByLabel("Username", { exact: true }).fill(name);
		await peer
			.getByLabel("Password", { exact: true })
			.fill("A secure ending peer password");
		await peer
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await expect(peer.getByRole("button", { name, exact: true })).toBeVisible();
		await peer.getByRole("button", { name: "New Game", exact: true }).click();
		await expect(
			peer.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		// Hai context headless không bảo đảm blur như hai tab thật; chốt Pause qua UI/server.
		await peer.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await expect.poll(() => peerState.snapshot?.self.paused).toBe(true);
		const peerRun = required(peerState.snapshot).playId,
			pausedGeneration = required(peerState.snapshot).generation;
		await winner.goto("/");
		await winner
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await winner
			.getByLabel("Username", { exact: true })
			.fill(required(process.env.E2E_FINISH_USERNAME));
		await winner
			.getByLabel("Password", { exact: true })
			.fill(required(process.env.E2E_FINISH_PASSWORD));
		await winner
			.getByRole("button", { name: "Sign In / Log In", exact: true })
			.click();
		await winner.getByRole("button", { name: "Continue", exact: true }).click();
		await expect(
			winner.getByRole("button", { name: "Skip", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		expect(finishEvents).toHaveLength(1);
		expect(required(finishEvents[0]).playId).toBe(process.env.E2E_FINISH_RUN);
		expect(peerFinishes).toEqual([]);
		expect(
			(await (await winner.request.get("/api/community/current")).json()).run,
		).toBeNull();
		const history = (await (await winner.request.get("/api/history")).json())
			.items;
		expect(
			history.filter(
				(row: { id: string }) => row.id === process.env.E2E_FINISH_RUN,
			),
		).toHaveLength(1);
		expect(history[0].status).toBe("FINISHED");
		expect(history[0].finishTimeMs).toBe(282616);
		expect(required(finishEvents[0]).ending).toMatchObject({ ravenDone: true });
		await winner.getByRole("button", { name: "Skip", exact: true }).click();
		await winner.screenshot({
			path: info.outputPath("community-ending-picture.png"),
		});
		await winner
			.getByRole("button", { name: "Back to Menu", exact: true })
			.click();
		await winner.getByRole("button", { name: "New Game", exact: true }).click();
		await expect(
			winner.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible();
		await expect(
			winner.getByRole("button", { name: "Skip", exact: true }),
		).toBeHidden();
		await expect
			.poll(() => winnerState.snapshot?.self.simulation.physics.jumps)
			.toBe(0);
		await winner
			.getByRole("button", { name: "Menu (Esc)", exact: true })
			.click();
		await winner
			.getByRole("button", { name: "Save & Exit", exact: true })
			.click();
		await expect(
			winner.getByRole("button", { name: "New Game", exact: true }),
		).toBeVisible();
		await peer.bringToFront();
		expect(
			peerDisconnected,
			"Peer WebSocket must survive the owner's ending",
		).toBe(false);
		await expect(
			peer.getByRole("heading", { name: "Paused", exact: true }),
		).toBeVisible();
		await peer.getByRole("button", { name: "Resume", exact: true }).click();
		await expect
			.poll(() => ({
				playId: peerState.snapshot?.playId,
				paused: peerState.snapshot?.self.paused,
				generationAdvanced:
					(peerState.snapshot?.generation ?? 0) > pausedGeneration,
			}))
			.toEqual({ playId: peerRun, paused: false, generationAdvanced: true });
		await peer.locator("canvas").click();
		await expect(peer.locator("canvas")).toBeFocused();
		await peer.keyboard.down("Space");
		try {
			// Chỉ thả Jump sau khi server thực sự nhận cạnh nhấn, không dựa vào thời gian ngủ.
			await expect
				.poll(() => peerState.snapshot?.self.simulation.physics.charge)
				.toBeGreaterThan(0);
		} finally {
			await peer.keyboard.up("Space");
		}
		await expect
			.poll(() => peerState.snapshot?.self.simulation.physics.jumps)
			.toBe(1);
		expect(peerDisconnected).toBe(false);
		await peer.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await peer
			.getByRole("button", { name: "Save & Exit", exact: true })
			.click();
		await expect(
			peer.getByRole("button", { name: "New Game", exact: true }),
		).toBeVisible();
		expect(peerFinishes).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		for (const context of [first, second])
			for (const page of context.pages()) await leaveOnline(page);
		await first.close();
		await second.close();
	}
});
