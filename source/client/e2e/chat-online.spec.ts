import { expect, test } from "@playwright/test";
import type { OnlineSnapshot } from "../src/game/netcode/OnlineRuntime";
import {
	createRoom,
	joinRoom,
	leaveOnline,
	registerOnline,
	startRoom,
} from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);
test("chat shortcuts, passive ten-second messages and touch work without launching a held jump", async ({
	browser,
}, info) => {
	test.setTimeout(60_000);
	const first = await browser.newContext(),
		second = await browser.newContext({
			viewport: { width: 390, height: 844 },
			isMobile: true,
			hasTouch: true,
		});
	try {
		for (const context of [first, second])
			await context.addInitScript(() =>
				localStorage.setItem(
					"jumpking.options",
					JSON.stringify({ sound: false }),
				),
			);
		const a = await first.newPage(),
			b = await second.newPage(),
			snapshots: OnlineSnapshot[] = [],
			errors: string[] = [];
		for (const page of [a, b])
			page.on("pageerror", (error) => errors.push(error.message));
		a.on("websocket", (socket) =>
			socket.on("framereceived", (frame) => {
				const message = JSON.parse(frame.payload.toString());
				if (message.type === "GAME_SNAPSHOT") snapshots.push(message.payload);
			}),
		);
		const hostName = await registerOnline(a, "chat_host"),
			peerName = await registerOnline(b, "touch_peer");
		const id = await createRoom(a);
		await joinRoom(b, id);
		await a.getByLabel("Message", { exact: true }).fill("Lobby hello");
		await a.getByRole("button", { name: "Send", exact: true }).click();
		await expect(b.getByRole("log")).toContainText("Lobby hello");
		await expect(b.getByLabel("Message", { exact: true })).toBeVisible();
		await expect(
			b.getByRole("button", { name: "Close chat", exact: true }),
		).toHaveCount(0);
		await startRoom(a, b);
		const preview = b.getByRole("region", {
			name: "New chat messages",
			exact: true,
		});
		await a.locator("canvas").click();
		const jumps = snapshots.at(-1)!.self.simulation.physics.jumps;
		const players = a.locator("summary").filter({ hasText: /^Players$/ });
		await players.focus();
		await a.keyboard.press("Enter");
		await expect(
			a.getByRole("list", { name: "Current players" }).locator("li"),
		).toHaveCount(2);
		await a.keyboard.press("Space");
		expect(snapshots.at(-1)!.self.simulation.physics.jumps).toBe(jumps);
		await a.locator("canvas").click();
		await expect(a.locator("canvas")).toBeFocused();
		await a.keyboard.down("Space");
		await expect
			.poll(() => snapshots.at(-1)?.self.simulation.physics.charge, {
				intervals: [20],
			})
			.toBeGreaterThan(0);
		await a.keyboard.press("Enter");
		await expect(a.getByLabel("Message", { exact: true })).toBeFocused();
		await a.keyboard.up("Space");
		await a.locator("canvas").click();
		await a.keyboard.press("Enter");
		await expect(a.getByLabel("Message", { exact: true })).toBeFocused();
		await expect
			.poll(() => snapshots.at(-1)?.self.simulation.physics.charge)
			.toBe(0);
		const elapsed = snapshots.at(-1)!.elapsedTimeMs;
		await a.getByLabel("Message", { exact: true }).fill("Online hello");
		await a.keyboard.press("Enter");
		await expect(preview).toContainText("Online hello");
		await expect(preview).toBeHidden({ timeout: 12000 });
		await expect(b.getByLabel("Message", { exact: true })).toHaveCount(0);
		await a.screenshot({ path: info.outputPath("online-chat.png") });
		await a.keyboard.press("Escape");
		await expect(
			a.getByRole("region", { name: "Room chat", exact: true }),
		).toHaveCount(0);
		await expect
			.poll(() => snapshots.at(-1)?.elapsedTimeMs ?? 0)
			.toBeGreaterThan(elapsed);
		expect(snapshots.at(-1)!.self.simulation.physics.jumps).toBe(jumps);
		await a.keyboard.down("Space");
		await a.waitForTimeout(180);
		await a.keyboard.up("Space");
		await expect
			.poll(
				() =>
					snapshots
						.at(-1)
						?.players?.find((player) => player.nickname === peerName)?.rank,
				{ intervals: [20] },
			)
			.toBe(2);
		await players.click();
		await expect(
			a.getByRole("list", { name: "Current players" }).locator("li").first(),
		).toContainText("1. " + hostName);
		await a.getByRole("button", { name: "Menu", exact: true }).click();
		await a.getByRole("button", { name: "End Match", exact: true }).click();
		await expect(
			a.getByRole("button", { name: "Play Again", exact: true }),
		).toBeEnabled();
		expect(errors).toEqual([]);
		await a.getByRole("button", { name: "Leave", exact: true }).click();
		await b.getByRole("button", { name: "Leave", exact: true }).click();
	} finally {
		for (const context of [first, second])
			for (const page of context.pages()) await leaveOnline(page);
		await first.close();
		await second.close();
	}
});
