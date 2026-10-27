import { expect, test } from "@playwright/test";
import { required } from "../src/required";
import {
	createRoom,
	joinRoom,
	leaveOnline,
	registerOnline,
	startRoom,
} from "./support/online";

test.skip(process.env.E2E_AUTH_ONLINE !== "true", "Requires backend/MySQL");
test("mobile Lobby keeps its roster, header and primary actions visible", async ({
	browser,
}, info) => {
	test.setTimeout(60_000);
	const first = await browser.newContext({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	const second = await browser.newContext();
	const host = await first.newPage(),
		peer = await second.newPage();
	try {
		for (const context of [first, second])
			await context.addInitScript(() =>
				localStorage.setItem(
					"jumpking.options",
					JSON.stringify({ sound: false }),
				),
			);
		const hostName = await registerOnline(host, "roster_host"),
			peerName = await registerOnline(peer, "roster_peer");
		const roomId = await createRoom(host);
		await joinRoom(peer, roomId);
		await host.bringToFront();
		for (const viewport of [
			{ width: 844, height: 390 },
			{ width: 932, height: 430 },
			{ width: 667, height: 375 },
			{ width: 568, height: 320 },
		]) {
			await host.setViewportSize(viewport);
			const roster = host.getByRole("region", { name: "Room players" });
			const list = roster.locator(".players");
			await expect(list).toContainText(hostName);
			await expect(list).toContainText(peerName);
			await expect
				.poll(async () => required(await list.boundingBox()).height)
				.toBeGreaterThanOrEqual(64);
			for (const row of await list.locator("li").all()) {
				await row.scrollIntoViewIfNeeded();
				await expect(row).toBeInViewport();
			}
			const header = required(
					await roster.locator(".lobby-header").boundingBox(),
				),
				title = required(
					await roster
						.getByRole("heading", { name: "Lobby", exact: true })
						.boundingBox(),
				),
				copy = required(
					await roster
						.getByRole("button", { name: "Copy room ID", exact: true })
						.boundingBox(),
				);
			expect(copy.x).toBeGreaterThan(title.x + title.width);
			expect(copy.x + copy.width).toBeCloseTo(header.x + header.width, 0);
			expect(
				Math.abs(copy.y + copy.height / 2 - title.y - title.height / 2),
			).toBeLessThan(1);
			await expect(roster).not.toContainText("ROOM ID:");
			await expect(roster.locator(".room-code code")).toHaveText(roomId);
			await expect(roster.locator(".lobby-actions > button")).toHaveText([
				"Start",
				"Cancel",
				"Leave",
			]);
			await host.screenshot({
				path: info.outputPath(`lobby-${viewport.width}.png`),
			});
		}
		await startRoom(host, peer);
		await host.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		const end = host.getByRole("button", { name: "End Match", exact: true });
		await expect(end).toHaveClass(/button-warning/);
		expect(
			await end.evaluate((element) => element.nextElementSibling?.className),
		).toBe("sound-switch");
		for (const button of [
			host.getByRole("button", { name: "Resume", exact: true }),
			host.getByRole("switch", { name: /^Sound:/ }),
			end,
			host.getByRole("button", { name: "Leave Room", exact: true }),
		]) {
			await expect(button).toBeInViewport({ ratio: 1 });
			const box = required(await button.boundingBox()),
				panel = required(
					await host.locator(".game-overlay .menu-panel").boundingBox(),
				);
			expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height);
		}
		await host.screenshot({ path: info.outputPath("room-menu-mobile.png") });
		await end.click();
		await expect(
			host.getByRole("heading", { name: "Results", exact: true }),
		).toBeVisible();
	} finally {
		for (const page of [host, peer]) await leaveOnline(page);
		await first.close();
		await second.close();
	}
});
