import { expect, type Page, test } from "@playwright/test";
import { createRoom, leaveOnline, registerOnline } from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);

async function checkLobbyLayout(page: Page) {
	const panel = page.locator(".lobby-panel"),
		chat = page.getByRole("region", { name: "Room chat", exact: true }),
		viewport = page.viewportSize();
	if (!viewport) throw new Error("Lobby checks require a viewport");
	await expect(panel).toBeVisible();
	await expect(chat).toBeVisible();
	await expect(page.locator(".room-code-label")).toHaveCount(0);
	const title = await page.locator(".lobby-header h3").boundingBox(),
		copy = await page.locator(".room-code-copy").boundingBox();
	if (!title || !copy) throw new Error("Lobby header is missing");
	expect(title.x + title.width).toBeLessThan(copy.x);
	expect(
		Math.abs(title.y + title.height / 2 - copy.y - copy.height / 2),
	).toBeLessThan(1);
	const panelBounds = await panel.boundingBox(),
		chatBounds = await chat.boundingBox();
	if (!panelBounds || !chatBounds) throw new Error("Lobby or chat is missing");
	expect(
		chatBounds.x + chatBounds.width <= panelBounds.x ||
			chatBounds.y >= panelBounds.y + panelBounds.height,
	).toBe(true);
	for (const bounds of [panelBounds, chatBounds]) {
		expect(bounds.x).toBeGreaterThanOrEqual(0);
		expect(bounds.y).toBeGreaterThanOrEqual(0);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
	}
	const message = chat.getByRole("textbox", { name: "Message", exact: true });
	await message.focus();
	await message.fill("Chat remains separate from the lobby");
	await expect(message).toHaveCSS("outline-style", "solid");
	await message.clear();
}

test("Public rooms can be discovered and joined while Private rooms remain accessible by ID", async ({
	browser,
}, info) => {
	const first = await browser.newContext(),
		second = await browser.newContext();
	try {
		await first.grantPermissions(["clipboard-read", "clipboard-write"]);
		for (const context of [first, second])
			await context.addInitScript(() =>
				localStorage.setItem(
					"jumpking.options",
					JSON.stringify({ sound: false }),
				),
			);
		const a = await first.newPage(),
			b = await second.newPage();
		await registerOnline(a, "public_host");
		await registerOnline(b, "public_peer");
		await createRoom(a);
		await a
			.getByRole("textbox", { name: "Message", exact: true })
			.fill("Lobby layout check");
		await a.getByRole("button", { name: "Send", exact: true }).click();
		await expect(a.getByRole("log", { name: "Messages" })).toContainText(
			"Lobby layout check",
		);
		for (const viewport of [
			{ width: 1280, height: 720 },
			{ width: 844, height: 390 },
			{ width: 390, height: 844 },
		]) {
			await a.setViewportSize(viewport);
			await checkLobbyLayout(a);
			await a.screenshot({
				path: info.outputPath(`lobby-${viewport.width}x${viewport.height}.png`),
			});
			if (viewport.width === 390) {
				await a
					.getByRole("textbox", { name: "Message", exact: true })
					.fill("x".repeat(201));
				await a
					.getByRole("textbox", { name: "Message", exact: true })
					.press("Enter");
				await expect(a.getByRole("alert")).toContainText(
					"Messages can contain up to",
				);
				await checkLobbyLayout(a);
			}
		}
		await a.setViewportSize({ width: 1280, height: 720 });
		await expect(a.getByLabel("Visibility", { exact: true })).toHaveValue(
			"PRIVATE",
		);
		await a.getByLabel("Visibility", { exact: true }).selectOption("PUBLIC");
		const id = await a.locator(".room-code code").innerText();
		const copyId = a.getByRole("button", {
			name: "Copy room ID",
			exact: true,
		});
		await a.bringToFront();
		await expect(a.locator(".room-code code")).toHaveCSS("user-select", "text");
		await copyId.click();
		await expect(a.locator(".room-code").getByRole("status")).toHaveText(
			"Copied",
		);
		expect(await a.evaluate(() => navigator.clipboard.readText())).toBe(id);
		expect(await a.evaluate(() => window.getSelection()?.toString())).toBe("");
		await a.evaluate(() => navigator.clipboard.writeText("unchanged"));
		await copyId.focus();
		await copyId.press("Enter");
		await expect
			.poll(() => a.evaluate(() => navigator.clipboard.readText()))
			.toBe(id);
		await a.evaluate(() => navigator.clipboard.writeText("unchanged"));
		const codeBounds = await a.locator(".room-code code").boundingBox();
		if (!codeBounds) throw new Error("Room ID is missing");
		await a.mouse.move(codeBounds.x + 1, codeBounds.y + codeBounds.height / 2);
		await a.mouse.down();
		await a.mouse.move(
			codeBounds.x + codeBounds.width - 1,
			codeBounds.y + codeBounds.height / 2,
			{ steps: 10 },
		);
		await a.mouse.up();
		expect(await a.evaluate(() => window.getSelection()?.toString())).not.toBe(
			"",
		);
		expect(await a.evaluate(() => navigator.clipboard.readText())).toBe(
			"unchanged",
		);
		await a.evaluate(() => window.getSelection()?.removeAllRanges());
		await expect(
			a.getByLabel("Map", { exact: true }).locator("option"),
		).toHaveCount(9);
		for (let level = 1; level <= 9; level++) {
			await a.getByLabel("Map", { exact: true }).selectOption(String(level));
			await expect(a.getByLabel("Map", { exact: true })).toHaveValue(
				String(level),
			);
		}
		await a.getByLabel("Map", { exact: true }).selectOption("3");
		await a.getByLabel("Time Limit", { exact: true }).selectOption("5");
		await a.getByLabel("Items cooldown", { exact: true }).selectOption("3");
		await b
			.getByRole("button", { name: "Join Public Room", exact: true })
			.click();
		await expect(b.getByRole("button", { name: new RegExp(id) })).toBeVisible();
		const publicRow = b.getByRole("row").filter({ hasText: id });
		await expect(publicRow).toContainText("3 min cooldown");
		await expect(publicRow).toContainText("5 min");
		await b.getByRole("button", { name: "Back", exact: true }).click();
		await expect(
			b.getByRole("button", { name: "Create Room", exact: true }),
		).toBeVisible();
		await expect(b.getByLabel("Room ID", { exact: true })).toBeVisible();
		await b
			.getByRole("button", { name: "Join Public Room", exact: true })
			.click();
		await expect(b.getByRole("button", { name: new RegExp(id) })).toBeVisible();
		await a.getByLabel("Visibility", { exact: true }).selectOption("PRIVATE");
		await expect(a.getByLabel("Visibility", { exact: true })).toHaveValue(
			"PRIVATE",
		);
		await b.getByRole("button", { name: "Refresh", exact: true }).click();
		await expect(b.getByRole("button", { name: new RegExp(id) })).toHaveCount(
			0,
		);
		expect(
			(await (await b.request.get(`/api/rooms/${id}`)).json()).joinable,
		).toBe(true);
		await a.getByLabel("Visibility", { exact: true }).selectOption("PUBLIC");
		await expect(a.getByLabel("Visibility", { exact: true })).toHaveValue(
			"PUBLIC",
		);
		await b.getByRole("button", { name: "Refresh", exact: true }).click();
		await b.getByRole("button", { name: new RegExp(id) }).click();
		await expect(b.locator(".room-code code")).toHaveText(id);
		await expect(b.getByLabel("Visibility", { exact: true })).toBeDisabled();
		await expect(b.getByLabel("Map", { exact: true })).toBeDisabled();
		await expect(b.getByLabel("Map", { exact: true })).toHaveValue("3");
		await a.getByLabel("Mode", { exact: true }).selectOption("HARDCORE");
		await expect(a.getByLabel("Mode", { exact: true })).toHaveValue("HARDCORE");
		const listed = (
			await (await b.request.get("/api/rooms")).json()
		).rooms.find((room: { roomId: string }) => room.roomId === id);
		expect(listed).toMatchObject({
			mode: "HARDCORE",
			mapId: 3,
			itemCooldownMinutes: 3,
			timeLimitMinutes: 5,
			playerCount: 2,
			capacity: 10,
		});
		await b.screenshot({ path: info.outputPath("public-room-lobby.png") });
		await a.bringToFront();
		await a.evaluate(() => {
			Object.defineProperty(navigator.clipboard, "writeText", {
				value: () =>
					Promise.reject(new DOMException("Not allowed", "NotAllowedError")),
			});
		});
		await copyId.click();
		await expect(a.locator(".room-code").getByRole("status")).toHaveText(
			"Unable to copy. Select the ID to copy.",
		);
		await b.getByRole("button", { name: "Leave", exact: true }).click();
		await a.getByRole("button", { name: "Leave", exact: true }).click();
	} finally {
		for (const context of [first, second])
			for (const page of context.pages()) await leaveOnline(page);
		await first.close();
		await second.close();
	}
});
