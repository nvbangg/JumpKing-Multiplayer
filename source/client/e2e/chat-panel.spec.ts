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
