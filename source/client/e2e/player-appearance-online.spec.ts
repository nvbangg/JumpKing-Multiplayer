import { expect, type Page, test } from "@playwright/test";
import rules from "../../common/rules.json" with { type: "json" };
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

async function captureScene(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const path = "/src/game/presentation/TowerScene.ts";
		const { TowerScene } = await import(path);
		const create = TowerScene.prototype.create;
		TowerScene.prototype.create = function () {
			(window as unknown as { appearanceScene: unknown }).appearanceScene =
				this;
			create.call(this);
		};
	});
}

async function appearance(page: Page) {
	return page.evaluate(() => {
		const scene = (
			window as unknown as {
				appearanceScene?: {
					runtime: {
						frame(): {
							self: { id: string; nickname: string; color: string };
							peers: { id: string; nickname: string; color: string }[];
						};
					};
					children: {
						list: {
							name: string;
							alpha: number;
							tintTopLeft: number;
							depth: number;
							visible: boolean;
						}[];
					};
				};
			}
		).appearanceScene;
		if (!scene) return null;
		const frame = scene.runtime.frame();
		return [frame.self, ...frame.peers].map((player) => {
			const sprite = scene.children.list.find(
				(child) => child.name === `player:${player.id}`,
			);
			return (
				sprite && {
					nickname: player.nickname,
					color: player.color,
					alpha: sprite.alpha,
					tint: sprite.tintTopLeft,
					depth: sprite.depth,
					visible: sprite.visible,
				}
			);
		});
	});
}

test("player colors match across browsers while only the local player has full opacity", async ({
	browser,
}, info) => {
	const contexts = await Promise.all([
		browser.newContext(),
		browser.newContext(),
	]);
	try {
		const [host, guest] = await Promise.all(
			contexts.map(async (context) => {
				await context.addInitScript(() =>
					localStorage.setItem(
						"jumpking.options",
						JSON.stringify({ sound: false }),
					),
				);
				const page = await context.newPage();
				await registerOnline(page, "appearance");
				await captureScene(page);
				return page;
			}),
		);
		const hostName = (
			await (await required(host).request.get("/api/auth/me")).json()
		).account.username;
		const peerName = (
			await (await required(guest).request.get("/api/auth/me")).json()
		).account.username;
		const id = await createRoom(required(host));
		await joinRoom(required(guest), id);
		await startRoom(required(host), required(guest));
		for (const [index, page] of [required(host), required(guest)].entries()) {
			await expect(
				page.getByRole("button", { name: "Menu", exact: true }),
			).toBeVisible({ timeout: 15_000 });
			const ownName = index === 0 ? hostName : peerName;
			const otherName = index === 0 ? peerName : hostName;
			const ownColor = required(rules.appearanceColors[index]);
			const peerColor = required(rules.appearanceColors[1 - index]);
			await expect
				.poll(async () => {
					const players = await appearance(page);
					return players?.map(
						(player) =>
							player && {
								nickname: player.nickname,
								color: player.color,
								alpha: player.alpha,
								tint: player.tint,
								visible: player.visible,
							},
					);
				})
				.toEqual([
					{
						nickname: ownName,
						color: ownColor,
						alpha: 1,
						tint: Number.parseInt(ownColor.slice(1), 16),
						visible: true,
					},
					{
						nickname: otherName,
						color: peerColor,
						alpha: 0.7,
						tint: Number.parseInt(peerColor.slice(1), 16),
						visible: true,
					},
				]);
			const players = await appearance(page);
			expect(required(required(players)[0]).depth).toBeGreaterThan(
				required(required(players)[1]).depth,
			);
			await page.bringToFront();
			if (
				await page
					.getByRole("button", { name: "Resume", exact: true })
					.isVisible()
			)
				await page.getByRole("button", { name: "Resume", exact: true }).click();
			await page.screenshot({
				path: info.outputPath(index === 0 ? "host-view.png" : "guest-view.png"),
			});
		}
	} finally {
		for (const context of contexts)
			for (const page of context.pages()) await leaveOnline(page);
		for (const context of contexts) await context.close();
	}
});
