import { expect, type Page, test } from "@playwright/test";
import { required } from "../src/required";
import { leaveOnline, observeOnline } from "./support/online";

test.skip(
	!process.env.E2E_ROOM_FINISH,
	"Requires the isolated Room ending fixture",
);
test("only the committed Room winner sees ending while peers can confirm the next game", async ({
	browser,
}, info) => {
	const fixture = JSON.parse(required(process.env.E2E_ROOM_FINISH));
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
			observed = observeOnline(winner),
			errors: string[] = [],
			winnerFinishes: unknown[] = [],
			peerFinishes: unknown[] = [];
		for (const [page, notices] of [
			[winner, winnerFinishes],
			[peer, peerFinishes],
		] as const) {
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("websocket", (socket) =>
				socket.on("framereceived", (frame) => {
					const message = JSON.parse(frame.payload.toString());
					if (message.type === "PLAYER_FINISHED") notices.push(message.payload);
				}),
			);
		}
		async function restore(page: Page, credential: typeof fixture.winner) {
			await page.goto("/");
			await page
				.getByRole("button", { name: "Sign In / Log In", exact: true })
				.click();
			await page
				.getByLabel("Username", { exact: true })
				.fill(credential.username);
			await page
				.getByLabel("Password", { exact: true })
				.fill(credential.password);
			await page
				.getByRole("button", { name: "Sign In / Log In", exact: true })
				.click();
			await expect(
				page.getByRole("button", { name: "New Game", exact: true }),
			).toBeVisible();
			await page.evaluate(async (value) => {
				const path = "/src/network/reconnect.ts";
				const { saveReconnect } = await import(path);
				await saveReconnect(
					`${location.origin}:account:${value.owner}`,
					value.context,
				);
			}, credential);
			await page.reload();
			await expect(
				page.getByRole("button", { name: /^(Menu|Skip|Play Again)$/ }),
			).toBeVisible({ timeout: 15_000 });
		}
		await restore(winner, fixture.winner);
		await restore(peer, fixture.peer);
		await expect(
			winner.getByRole("button", { name: "Skip", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			peer.getByRole("button", { name: "Play Again", exact: true }),
		).toBeEnabled();
		expect(peerFinishes).toEqual([]);
		expect(winnerFinishes).toHaveLength(1);
		const history = await (
			await winner.request.get(`/api/history/ROOM/${fixture.playId}`)
		).json();
		expect(
			history.participants.filter((row: { isWinner: boolean }) => row.isWinner),
		).toHaveLength(1);
		await peer.getByRole("button", { name: "Play Again", exact: true }).click();
		await expect(
			peer.getByRole("heading", { name: "Lobby", exact: true }),
		).toBeVisible();
		await expect(
			winner.getByRole("button", { name: "Skip", exact: true }),
		).toBeVisible();
		await winner.getByRole("button", { name: "Skip", exact: true }).click();
		await expect(
			winner.getByRole("button", { name: "View Results", exact: true }),
		).toBeEnabled();
		await winner.screenshot({
			path: info.outputPath("room-winner-ending.png"),
		});
		await winner
			.getByRole("button", { name: "View Results", exact: true })
			.click();
		await expect(
			winner.getByRole("button", { name: "Play Again", exact: true }),
		).toBeEnabled();
		await winner
			.getByRole("button", { name: "Play Again", exact: true })
			.click();
		await winner.getByRole("button", { name: "Start", exact: true }).click();
		await expect(
			winner.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			winner.getByRole("button", { name: "Skip", exact: true }),
		).toBeHidden();
		await expect.poll(() => observed.snapshot?.playId).not.toBe(fixture.playId);
		expect(required(observed.snapshot).self.simulation.physics.jumps).toBe(0);
		await winner
			.getByRole("button", { name: "Menu (Esc)", exact: true })
			.click();
		await winner
			.getByRole("button", { name: "End Match", exact: true })
			.click();
		await expect(
			winner.getByRole("button", { name: "Play Again", exact: true }),
		).toBeEnabled();
		expect(winnerFinishes).toHaveLength(1);
		expect(peerFinishes).toEqual([]);
		expect(errors).toEqual([]);
		await winner.getByRole("button", { name: "Leave", exact: true }).click();
		await peer.getByRole("button", { name: "Leave", exact: true }).click();
	} finally {
		for (const context of [first, second])
			for (const page of context.pages()) await leaveOnline(page);
		await first.close();
		await second.close();
	}
});
