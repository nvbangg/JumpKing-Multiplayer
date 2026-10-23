import { expect, test } from "@playwright/test";
import type { OnlineSnapshot } from "../src/game/netcode/OnlineRuntime";
import { required } from "../src/required";
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
test("persistent scrollable chat, shortcuts and touch work without launching a held jump", async ({
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
		await expect(a.getByLabel("Message", { exact: true })).toBeFocused();
		await expect(b.getByRole("log")).toContainText("Lobby hello");
		await expect(b.getByLabel("Message", { exact: true })).toBeVisible();
		await expect(
			b.getByRole("button", { name: "Close chat", exact: true }),
		).toHaveCount(0);
		await startRoom(a, b);
		const history = b.getByRole("log");
		await a.locator("canvas").click();
		const jumps = required(snapshots.at(-1)).self.simulation.physics.jumps;
		await expect(a.locator(".players-panel > summary")).toBeVisible();
		await expect(
			a.getByRole("list", { name: "Current players" }).locator("li"),
		).toHaveCount(2);
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
		const elapsed = required(snapshots.at(-1)).elapsedTimeMs;
		await a.getByLabel("Message", { exact: true }).fill("Online hello");
		await a.keyboard.press("Enter");
		await expect(history).toContainText("Online hello");
		await expect(a.getByLabel("Message", { exact: true })).toBeFocused();
		await expect(b.getByLabel("Message", { exact: true })).toBeVisible();
		for (let index = 0; index < 10; index++) {
			// Tôn trọng cooldown chat thật trên server.
			await a.waitForTimeout(1100);
			await a
				.getByLabel("Message", { exact: true })
				.fill(`Line ${index} ${"message ".repeat(18)}`);
			await a.getByRole("button", { name: "Send", exact: true }).click();
			await expect(history).toContainText(`Line ${index}`);
		}
		await b.locator(".chat-panel > summary").tap();
		await expect(b.getByLabel("Message", { exact: true })).toBeHidden();
		await a.waitForTimeout(1100);
		const latest = `Latest message ${"message ".repeat(18)}`;
		await a.getByLabel("Message", { exact: true }).fill(latest);
		await a.getByRole("button", { name: "Send", exact: true }).click();
		await expect(b.locator(".chat-messages")).toContainText(latest);
		await b.locator(".chat-panel > summary").tap();
		await expect(history.locator("p").last()).toBeInViewport();
		await expect(history.locator("p")).toHaveCount(13);
		await expect(history).toContainText("Online hello");
		expect(
			await history.evaluate(
				(element) =>
					element.scrollHeight - element.clientHeight - element.scrollTop,
			),
		).toBeLessThanOrEqual(1);
		await expect(b.getByLabel("Message", { exact: true })).not.toBeFocused();
		await a.screenshot({ path: info.outputPath("online-chat.png") });
		await a.getByRole("log").evaluate((element) => {
			element.scrollTop = 0;
		});
		await a.getByLabel("Message", { exact: true }).fill("draft");
		expect(
			await a.getByRole("log").evaluate((element) => element.scrollTop),
		).toBe(0);
		await a.keyboard.press("Escape");
		await a.keyboard.press("Enter");
		await expect(a.getByLabel("Message", { exact: true })).toBeFocused();
		await a.keyboard.press("Escape");
		await expect(a.locator(".chat-panel")).toBeVisible();
		await expect(a.getByLabel("Message", { exact: true })).not.toBeFocused();
		await expect
			.poll(() => snapshots.at(-1)?.elapsedTimeMs ?? 0)
			.toBeGreaterThan(elapsed);
		await a.keyboard.press("Enter");
		await a.keyboard.press("Escape");
		await a.keyboard.press("Escape");
		await expect(
			a.getByRole("button", { name: "Resume", exact: true }),
		).toBeVisible();
		await expect(a.locator(".chat-panel > summary")).toBeVisible();
		await a.getByRole("button", { name: "Resume", exact: true }).click();
		expect(required(snapshots.at(-1)).self.simulation.physics.jumps).toBe(
			jumps,
		);
		await a.locator("canvas").click();
		await a.keyboard.down("Space");
		await a.waitForTimeout(180);
		await a.keyboard.up("Space");
		await expect
			.poll(() => snapshots.at(-1)?.self.simulation.physics.jumps)
			.toBe(jumps + 1);
		// Nhảy thẳng đáp lại cùng nền: Race vẫn đồng hạng theo currentProgress.
		await expect
			.poll(() => snapshots.at(-1)?.self.simulation.physics.grounded)
			.toBe(true);
		expect(
			required(required(snapshots.at(-1)).players).map((player) => player.rank),
		).toEqual([1, 1]);
		await expect(
			a.getByRole("list", { name: "Current players" }),
		).toContainText(hostName);
		await expect(
			a.getByRole("list", { name: "Current players" }),
		).toContainText(peerName);
		await b.bringToFront();
		if (
			await b.getByRole("button", { name: "Resume", exact: true }).isVisible()
		)
			await b.getByRole("button", { name: "Resume", exact: true }).click();
		const chatBox = await b.locator(".chat-panel").boundingBox();
		const controlsBox = await b
			.getByRole("button", { name: "Move Left", exact: true })
			.boundingBox();
		expect(
			chatBox && controlsBox && controlsBox.y + controlsBox.height <= chatBox.y,
		).toBe(true);
		await b.getByRole("button", { name: "Move Left", exact: true }).tap();
		await b.screenshot({ path: info.outputPath("mobile-chat.png") });
		await a.bringToFront();
		if (
			await a.getByRole("button", { name: "Resume", exact: true }).isVisible()
		)
			await a.getByRole("button", { name: "Resume", exact: true }).click();
		await a.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
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
