import { expect, test } from "@playwright/test";

test("a delayed chat acknowledgement preserves the next draft and input focus", async ({
	page,
}) => {
	await page.goto("/");
	await page.evaluate(async () => {
		const path = "/e2e/support/chat-panel.tsx";
		const { mountChatPanel } = await import(path);
		Object.assign(window, { acknowledgeChat: mountChatPanel() });
	});
	const message = page.getByRole("textbox", { name: "Message", exact: true });
	const send = page.getByRole("button", { name: "Send", exact: true });
	await message.fill("first message");
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
	await expect(page.locator('[data-closed="true"]')).toHaveCount(1);
});

test("chat keeps the reading position when capped history advances and Latest returns to the end", async ({
	page,
}) => {
	await page.goto("/");
	await page.evaluate(async () => {
		const path = "/e2e/support/chat-panel.tsx";
		const { mountChatHistory } = await import(path);
		Object.assign(window, { appendChat: mountChatHistory() });
	});
	const log = page.getByRole("log", { name: "Messages" });
	await expect(log.locator("p")).toHaveCount(50);
	await expect
		.poll(() =>
			log.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop),
		)
		.toBeLessThanOrEqual(1);
	await log.evaluate((e) => {
		e.scrollTop = 400;
	});
	await expect(
		page.getByRole("button", { name: "Latest", exact: true }),
	).toBeVisible();
	const before = await log
		.locator('[data-message-id="20"]')
		.evaluate((e) => e.getBoundingClientRect().top);
	await page.evaluate(() =>
		(window as unknown as { appendChat: () => void }).appendChat(),
	);
	await expect(log.locator('[data-message-id="50"]')).toHaveCount(1);
	await expect
		.poll(async () =>
			Math.abs(
				(await log
					.locator('[data-message-id="20"]')
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
