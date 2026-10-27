import { expect, test } from "@playwright/test";
import rules from "../../common/rules.json" with { type: "json" };
import { required } from "../src/required";
import {
	createRoom,
	leaveOnline,
	newCommunity,
	observeOnline,
	registerOnline,
} from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);

for (const mobile of [false, true])
	test(`chat, refresh, HUD and Sound keep working (${mobile ? "mobile" : "desktop"})`, async ({
		browser,
	}, info) => {
		test.setTimeout(60_000);
		const context = await browser.newContext({
			viewport: mobile
				? { width: 844, height: 390 }
				: { width: 1920, height: 1080 },
			isMobile: mobile,
			hasTouch: mobile,
		});
		const page = await context.newPage();
		const observed = observeOnline(page);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await context.addInitScript(() =>
				localStorage.setItem(
					"jumpking.options",
					JSON.stringify({ sound: false }),
				),
			);
			const username = await registerOnline(page, "hud");
			await newCommunity(page);
			await expect
				.poll(() => observed.snapshot?.self.simulation.physics.grounded)
				.toBe(true);
			const badges = page.locator(".game-hud > *");
			await expect(badges).toHaveCount(3);
			for (const width of mobile ? [844, 568] : [1920, 1440]) {
				await page.setViewportSize({ width, height: mobile ? 390 : 1080 });
				await expect
					.poll(async () => {
						const stage = required(
							await page.locator(".game-stage").boundingBox(),
						);
						return badges.evaluateAll(
							(elements, left) =>
								elements.every((element) => {
									const rect = element.getBoundingClientRect();
									return rect.left >= 0 && rect.right <= left;
								}),
							stage.x,
						);
					})
					.toBe(true);
				const rows = await badges.evaluateAll((elements) =>
					elements.map((element) => {
						const rect = element.getBoundingClientRect();
						return Math.round(rect.top + rect.height / 2);
					}),
				);
				if (width === 1920) expect(new Set(rows).size).toBe(1);
				else expect(new Set(rows).size).toBeGreaterThan(1);
			}
			// Bảng Players và sprite dùng cùng bảng màu theo membership thật.
			const me = page.getByRole("button", {
				name: `Watch ${username}`,
				exact: true,
			});
			const slot = required(
				observed.snapshot?.players?.find(
					(player) => player.nickname === username,
				),
			).colorSlot;
			const color = Number.parseInt(
				required(rules.appearanceColors[slot]).slice(1),
				16,
			);
			await expect(me).toHaveCSS(
				"color",
				`rgb(${color >> 16}, ${(color >> 8) & 255}, ${color & 255})`,
			);
			await page
				.getByRole("button", { name: "Menu (Esc)", exact: true })
				.click();
			const sound = page.getByRole("switch", {
				name: /^Sound:/,
			});
			await expect(sound).toHaveText("Sound");
			const thumb = sound.locator(".switch-track > span");
			const offX = required(await thumb.boundingBox()).x;
			await sound.click();
			await expect(sound).toHaveAttribute("aria-checked", "true");
			await expect
				.poll(async () => required(await thumb.boundingBox()).x - offX)
				.toBe(20);
			await sound.click();
			await expect
				.poll(async () => required(await thumb.boundingBox()).x)
				.toBe(offX);
			const chat = page.getByLabel("Message", { exact: true });
			await chat.click();
			await chat.fill("Chat while paused");
			await page.keyboard.press("Enter");
			await expect(page.getByRole("log")).toContainText("Chat while paused");
			await expect(
				page.getByRole("button", { name: "Resume", exact: true }),
			).toBeVisible();
			await page.screenshot({ path: info.outputPath("pause-chat.png") });
			await page.getByRole("button", { name: "Resume", exact: true }).click();
			await expect(page.locator("canvas")).toBeFocused();
			await page.keyboard.press("Enter");
			await expect(chat).toBeFocused();
			await chat.fill("Chat after resume");
			await page.waitForTimeout(1100);
			await page.keyboard.press("Enter");
			await expect(page.getByRole("log")).toContainText("Chat after resume");
			await page.keyboard.press("Escape");
			const refresh = page.getByRole("button", {
				name: "Refresh",
				exact: true,
			});
			await expect(refresh).toBeEnabled();
			// Cả click lẫn kích hoạt bằng bàn phím phải trả điều khiển ngay cho game.
			for (const keyboard of [false, true]) {
				if (keyboard) {
					await refresh.focus();
					await page.keyboard.press("Enter");
				} else await refresh.click();
				await expect(page.locator("canvas")).toBeFocused();
				await expect
					.poll(() => observed.snapshot?.self.simulation.physics.grounded)
					.toBe(true);
				const jumps = required(observed.snapshot).self.simulation.physics.jumps;
				await page.keyboard.down("Space");
				await expect
					.poll(() => observed.snapshot?.self.simulation.physics.charge)
					.toBeGreaterThan(0);
				await page.keyboard.up("Space");
				await expect
					.poll(() => observed.snapshot?.self.simulation.physics.jumps)
					.toBe(jumps + 1);
				await expect(refresh).toBeEnabled();
			}
			await page.screenshot({ path: info.outputPath("hud.png") });
			await page
				.getByRole("button", { name: "Menu (Esc)", exact: true })
				.click();
			await page
				.getByRole("button", { name: "Save & Exit", exact: true })
				.click();
			await createRoom(page);
			await page.getByLabel("Time Limit", { exact: true }).selectOption("5");
			await page.getByRole("button", { name: "Start", exact: true }).click();
			await expect(page.getByLabel("Time left", { exact: true })).toBeVisible();
			await expect(badges).toHaveCount(4);
			if (!mobile) {
				await page.setViewportSize({ width: 1920, height: 1080 });
				await expect
					.poll(async () =>
						badges.evaluateAll(
							(elements) =>
								new Set(
									elements.map((element) => {
										const rect = element.getBoundingClientRect();
										return Math.round(rect.top + rect.height / 2);
									}),
								).size,
						),
					)
					.toBe(1);
			}
			const stage = required(await page.locator(".game-stage").boundingBox());
			for (const badge of await badges.all()) {
				const bounds = required(await badge.boundingBox());
				expect(bounds.x).toBeGreaterThanOrEqual(0);
				expect(bounds.x + bounds.width).toBeLessThanOrEqual(stage.x);
			}
			await page.screenshot({ path: info.outputPath("room-timers.png") });
			expect(errors).toEqual([]);
		} finally {
			await leaveOnline(page);
			await context.close();
		}
	});
