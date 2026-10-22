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
						viewport: { width: 320, height: 740 },
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
					expect(box && bounds.y + bounds.height <= box.y).toBeTruthy();
				}
			}
			await page.screenshot({ path: info.outputPath("tutorial.png") });
			await page
				.getByRole("button", { name: "Next step", exact: true })
				.click();
			await expect(guide).toContainText("Step 2/3: Charge");
			await page
				.getByRole("button", { name: "Previous step", exact: true })
				.click();
			await expect(guide).toContainText("Step 1/3: Move");
			await page.locator("canvas").click();
			await page.keyboard.down("KeyD");
			await expect(guide).toContainText("Step 2/3: Charge");
			await page.keyboard.up("KeyD");
			if (mobile) {
				const jump = await page
					.getByRole("button", { name: "Jump", exact: true })
					.boundingBox();
				if (!jump) throw new Error("Missing touch jump");
				const cdp = await context.newCDPSession(page);
				await cdp.send("Input.dispatchTouchEvent", {
					type: "touchStart",
					touchPoints: [
						{ x: jump.x + jump.width / 2, y: jump.y + jump.height / 2 },
					],
				});
				await expect(guide).toContainText("Step 3/3: Jump");
				await cdp.send("Input.dispatchTouchEvent", {
					type: "touchEnd",
					touchPoints: [],
				});
				await cdp.detach();
			} else {
				await page.keyboard.down("Space");
				await expect(guide).toContainText("Step 3/3: Jump");
				await page.keyboard.up("Space");
			}
			await expect
				.poll(() => observed.snapshot?.self.simulation.physics.jumps)
				.toBeGreaterThan(0);
			await expect(guide).toContainText("Ready to Climb!");
			await expect(guide).toBeHidden({ timeout: 6500 });
			await page.getByRole("button", { name: "Menu", exact: true }).click();
			await page
				.getByRole("button", { name: "Save & Exit", exact: true })
				.click();
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
		await page.getByRole("button", { name: "Menu", exact: true }).click();
		await page.getByRole("button", { name: "Leave Room", exact: true }).click();
		await newCommunity(page);
		await expect(guide).toBeVisible();
		await page
			.getByRole("button", { name: "Skip tutorial", exact: true })
			.click();
		await expect(guide).toHaveCount(0);
		await page.getByRole("button", { name: "Menu", exact: true }).click();
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
