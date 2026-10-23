import { expect, test } from "@playwright/test";
import {
	createRoom,
	leaveOnline,
	newCommunity,
	observeOnline,
	registerOnline,
	startRoom,
} from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires isolated backend/MySQL",
);

for (const mobile of [false, true])
	test(`Community tutorial progresses and stays dismissed (${mobile ? "mobile" : "desktop"})`, async ({
		browser,
	}, info) => {
		const context = await browser.newContext(
			mobile
				? {
						viewport: { width: 740, height: 320 },
						hasTouch: true,
						isMobile: true,
					}
				: {},
		);
		const page = await context.newPage();
		const observed = observeOnline(page);
		try {
			await registerOnline(page, "tutorial");
			await newCommunity(page);
			const guide = page.getByRole("complementary", { name: "Tutorial guide" });
			await expect(guide).toContainText("Step 1/3: Move");
			const bounds = await guide.boundingBox();
			expect(
				bounds &&
					bounds.x >= 0 &&
					bounds.x + bounds.width <= (page.viewportSize()?.width ?? 0),
			).toBeTruthy();
			if (mobile && bounds) {
				for (const control of [
					page.locator(".chat-input-box"),
					page.getByRole("button", { name: "Jump", exact: true }),
				]) {
					const box = await control.boundingBox();
					expect(
						box &&
							(bounds.y + bounds.height <= box.y ||
								box.y + box.height <= bounds.y ||
								bounds.x + bounds.width <= box.x ||
								box.x + box.width <= bounds.x),
					).toBeTruthy();
				}
			}
			await page.screenshot({ path: info.outputPath("tutorial.png") });
			await expect(
				guide.getByRole("button", { name: "Next step" }),
			).toHaveCount(0);
			await expect(
				guide.getByRole("button", { name: "Previous step" }),
			).toHaveCount(0);
			await page.locator("canvas").click();
			await page.keyboard.down("Space");
			await expect
				.poll(() => observed.snapshot?.self.simulation.physics.charge ?? 0)
				.toBeGreaterThanOrEqual(4);
			await page.keyboard.up("Space");
			await expect
				.poll(() => observed.snapshot?.self.simulation.physics.jumps)
				.toBe(1);
			await expect(guide).toContainText("Step 1/3: Move");
			await expect
				.poll(() => observed.snapshot?.self.simulation.physics.grounded)
				.toBe(true);
			await page.keyboard.down("KeyD");
			await expect(guide).toContainText("Step 2/3: Charge");
			await page.keyboard.up("KeyD");
			if (mobile) {
				const jump = await page
					.getByRole("button", { name: "Jump", exact: true })
					.boundingBox();
				const right = await page
					.getByRole("button", { name: "Move Right", exact: true })
					.boundingBox();
				if (!jump || !right) throw new Error("Missing touch controls");
				const jumpPoint = {
					id: 1,
					x: jump.x + jump.width / 2,
					y: jump.y + jump.height / 2,
				};
				const rightPoint = {
					id: 2,
					x: right.x + right.width / 2,
					y: right.y + right.height / 2,
				};
				const cdp = await context.newCDPSession(page);
				await cdp.send("Input.dispatchTouchEvent", {
					type: "touchStart",
					touchPoints: [jumpPoint],
				});
				await expect(guide).toContainText("Step 3/3: Jump");
				await cdp.send("Input.dispatchTouchEvent", {
					type: "touchStart",
					touchPoints: [jumpPoint, rightPoint],
				});
				await expect
					.poll(() => observed.snapshot?.self.simulation.physics.directions[0])
					.toBe(1);
				await cdp.send("Input.dispatchTouchEvent", {
					type: "touchEnd",
					touchPoints: [],
				});
				await expect(guide).toContainText("Ready to Climb!");
				await cdp.detach();
			} else {
				await page.keyboard.down("Space");
				await expect(guide).toContainText("Step 3/3: Jump");
				await page.keyboard.down("KeyD");
				await page.keyboard.up("Space");
				await expect(guide).toContainText("Ready to Climb!");
				await page.keyboard.up("KeyD");
			}
			await expect
				.poll(() => observed.snapshot?.self.simulation.physics.jumps)
				.toBeGreaterThan(1);
			await expect(guide).toContainText("Ready to Climb!");
			await expect(guide).toBeHidden({ timeout: 6500 });
			await page
				.getByRole("button", { name: "Menu (Esc)", exact: true })
				.click();
			const sound = page.getByRole("switch", {
				name: "Sound: On",
				exact: true,
			});
			await sound.click();
			await expect(
				page.getByRole("switch", { name: "Sound: Off", exact: true }),
			).toBeVisible();
			await page
				.getByRole("button", { name: "Save & Exit", exact: true })
				.click();
			await expect(
				page.getByRole("switch", { name: "Sound: Off", exact: true }),
			).toBeVisible();
			await page.getByRole("button", { name: "Continue", exact: true }).click();
			await expect(page.locator("canvas")).toBeVisible();
			await expect(guide).toHaveCount(0);
		} finally {
			await leaveOnline(page);
			await context.close();
		}
	});

test("Room never shows or completes the Community tutorial; Skip survives Continue", async ({
	page,
}) => {
	const observed = observeOnline(page);
	try {
		await registerOnline(page, "tutorial_room");
		await createRoom(page);
		await startRoom(page, page);
		const guide = page.getByRole("complementary", { name: "Tutorial guide" });
		await expect(guide).toHaveCount(0);
		await page.keyboard.down("KeyD");
		await expect
			.poll(() => observed.snapshot?.self.simulation.physics.x)
			.toBeGreaterThan(240);
		await page.keyboard.up("KeyD");
		await expect(guide).toHaveCount(0);
		await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await page.getByRole("button", { name: "Leave Room", exact: true }).click();
		await newCommunity(page);
		await expect(guide).toBeVisible();
		await page
			.getByRole("button", { name: "Skip tutorial", exact: true })
			.click();
		await expect(guide).toHaveCount(0);
		await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await page
			.getByRole("button", { name: "Save & Exit", exact: true })
			.click();
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await expect(page.locator("canvas")).toBeVisible();
		await expect(guide).toHaveCount(0);
	} finally {
		await leaveOnline(page);
	}
});
