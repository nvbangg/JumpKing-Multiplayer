import { expect, test } from "@playwright/test";

test("a delayed chat acknowledgement preserves the next draft and input focus", async ({
	page,
}) => {
	await page.goto("/");
	await page.evaluate(async () => {
		const path = "/e2e/support/chat-panel.tsx";
		const { mountChatPanel } = await import(path);
		Object.assign(window, mountChatPanel());
	});
	const message = page.getByRole("textbox", { name: "Message", exact: true });
	const send = page.getByRole("button", { name: "Send", exact: true });
	await message.fill("first message");
	await expect(message).toHaveCSS("outline-style", "solid");
	await message.press("Enter");
	await expect(send).toBeDisabled();
	await message.fill("next draft");
	await page.evaluate(() =>
		(window as unknown as { acknowledgeChat: () => void }).acknowledgeChat(),
	);
	await expect(send).toBeEnabled();
	await expect(message).toHaveValue("next draft");
	await expect(message).toBeFocused();
	await expect(page.locator("[data-closed]")).toHaveCount(0);
	await message.press("Enter");
	await expect(send).toBeDisabled();
	await page.evaluate(() =>
		(window as unknown as { acknowledgeChat: () => void }).acknowledgeChat(),
	);
	await expect(message).toHaveValue("");
	await expect(message).toBeFocused();
	await expect(page.locator("[data-closed]")).toHaveCount(0);
	await message.fill("last message");
	await message.press("Enter");
	await message.press("Escape");
	await page.evaluate(() =>
		(window as unknown as { acknowledgeChat: () => void }).acknowledgeChat(),
	);
	await expect(message).toHaveValue("");
	await expect(message).not.toBeFocused();
	await expect(page.locator('[data-closed="true"]')).toHaveCount(1);
});

test("chat input stays visible while history expires, reopens on hover and new messages", async ({
	page,
}, info) => {
	await page.clock.install();
	await page.goto("/");
	await page.evaluate(async () => {
		const path = "/e2e/support/chat-panel.tsx";
		const { mountChatHistory } = await import(path);
		Object.assign(window, { appendChat: mountChatHistory() });
	});
	const message = page.getByRole("textbox", { name: "Message", exact: true });
	const history = page.locator(".chat-history-box");
	await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
	await expect(message).toBeVisible();
	await expect(page.locator(".chat-panel > summary")).toHaveCount(0);
	await expect(history).toHaveAttribute("data-hidden", "false");
	const toggle = page.getByRole("button", {
		name: "Show chat history",
		exact: true,
	});
	await expect(toggle).toBeVisible();
	expect(
		await toggle.evaluate((element) => element.getBoundingClientRect().bottom),
	).toBeLessThanOrEqual(
		await message.evaluate((element) => element.getBoundingClientRect().top),
	);
	await page.evaluate(() =>
		(window as unknown as { appendChat: () => void }).appendChat(),
	);
	await page.clock.fastForward(14_999);
	await expect(history).toHaveAttribute("data-hidden", "false");
	await page.clock.fastForward(1);
	await expect(history).toHaveAttribute("data-hidden", "true");
	await expect(message).toBeVisible();
	await expect(history).toBeHidden();
	await expect(toggle).toHaveCount(0);
	await expect(page.locator(".chat-input-box button")).toHaveCount(1);
	const panel = page.getByRole("region", { name: "Room chat", exact: true });
	const sizes = await panel.evaluate((element) => {
		const css = getComputedStyle(element);
		const input = element.querySelector(".chat-input-box");
		if (!input) throw new Error("Missing chat input");
		return {
			panel: element.getBoundingClientRect().height,
			input:
				input.getBoundingClientRect().height +
				parseFloat(css.paddingTop) +
				parseFloat(css.paddingBottom) +
				parseFloat(css.borderTopWidth) +
				parseFloat(css.borderBottomWidth),
		};
	});
	expect(sizes.panel).toBeCloseTo(sizes.input, 1);
	await panel.screenshot({ path: info.outputPath("chat-collapsed.png") });
	if (info.project.use.isMobile) await message.tap();
	else await panel.hover();
	await expect(history).toHaveAttribute("data-hidden", "false");
	await expect(toggle).toBeVisible();
	if (info.project.use.isMobile) await expect(message).toBeFocused();
	else await expect(message).not.toBeFocused();
	await history.hover();
	await expect(history).toHaveAttribute("data-hidden", "false");
	await page.clock.fastForward(10000);
	await expect(history).toHaveAttribute("data-hidden", "false");
	await page.mouse.move(0, 0);
	await page.clock.fastForward(14_999);
	await expect(history).toHaveAttribute("data-hidden", "false");
	await page.clock.fastForward(1);
	await expect(history).toHaveAttribute("data-hidden", "true");
	await page.evaluate(() =>
		(window as unknown as { appendChat: () => void }).appendChat(),
	);
	await expect(history).toHaveAttribute("data-hidden", "false");
	await expect(history.locator("p").last()).toBeInViewport();
	await message.fill("draft");
	await expect(history).toHaveAttribute("data-hidden", "false");
	await page.clock.fastForward(14_999);
	await expect(history).toHaveAttribute("data-hidden", "false");
	await page.clock.fastForward(1);
	await expect(history).toHaveAttribute("data-hidden", "true");
	await expect(message).toBeVisible();
	await expect(message).toHaveValue("draft");
	await message.evaluate((input) => input.blur());
	await message.evaluate((input) => input.focus());
	await expect(history).toHaveAttribute("data-hidden", "false");
	await message.press("Escape");
	await page.clock.fastForward(14_999);
	await expect(history).toHaveAttribute("data-hidden", "false");
	await page.clock.fastForward(1);
	await expect(history).toHaveAttribute("data-hidden", "true");
	await expect(message).toHaveValue("draft");
});

test("chat keeps the reading position when capped history advances and Latest returns to the end", async ({
	page,
}) => {
	await page.clock.install();
	await page.goto("/");
	await page.evaluate(async () => {
		const path = "/e2e/support/chat-panel.tsx";
		const { mountChatHistory } = await import(path);
		Object.assign(window, { appendChat: mountChatHistory() });
	});
	const log = page.getByRole("log", { name: "Messages" });
	await expect(log.locator("p")).toHaveCount(30);
	await expect
		.poll(() =>
			log.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop),
		)
		.toBeLessThanOrEqual(1);
	await log.evaluate((e) => {
		e.scrollTop = 160;
	});
	await expect(
		page.getByRole("button", { name: "Latest", exact: true }),
	).toBeVisible();
	const before = await log
		.locator('[data-message-id="10"]')
		.evaluate((e) => e.getBoundingClientRect().top);
	await page.clock.fastForward(15_000);
	await expect(log).toBeHidden();
	await page.getByRole("region", { name: "Room chat", exact: true }).hover();
	await expect(log).toBeVisible();
	await page.evaluate(() =>
		(window as unknown as { appendChat: () => void }).appendChat(),
	);
	await expect(log.locator('[data-message-id="30"]')).toHaveCount(1);
	await expect
		.poll(async () =>
			Math.abs(
				(await log
					.locator('[data-message-id="10"]')
					.evaluate((e) => e.getBoundingClientRect().top)) - before,
			),
		)
		.toBeLessThanOrEqual(1);
	await page.getByRole("button", { name: "Latest", exact: true }).click();
	await expect
		.poll(() =>
			log.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop),
		)
		.toBeLessThanOrEqual(1);
	await expect(
		page.getByRole("button", { name: "Latest", exact: true }),
	).toHaveCount(0);
});
