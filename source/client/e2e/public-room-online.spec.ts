import { expect, test } from "@playwright/test";
import { createRoom, leaveOnline, registerOnline } from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);

test("Public rooms can be discovered and joined while Private rooms remain accessible by ID", async ({
	browser,
}, info) => {
	const first = await browser.newContext(),
		second = await browser.newContext();
	try {
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
		await expect(a.getByLabel("Visibility", { exact: true })).toHaveValue(
			"PRIVATE",
		);
		await a.getByLabel("Visibility", { exact: true }).selectOption("PUBLIC");
		const id = await a.locator(".room-code code").innerText();
		await expect(
			a.getByLabel("Map", { exact: true }).locator("option"),
		).toHaveCount(10);
		for (let level = 1; level <= 10; level++) {
			await a.getByLabel("Map", { exact: true }).selectOption(String(level));
			await expect(a.getByLabel("Map", { exact: true })).toHaveValue(
				String(level),
			);
		}
		await a.getByLabel("Map", { exact: true }).selectOption("3");
		await b.getByRole("button", { name: "Room", exact: true }).click();
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
			mapLevel: 3,
			playerCount: 2,
			capacity: 10,
		});
		await b.screenshot({ path: info.outputPath("public-room-lobby.png") });
		await b.getByRole("button", { name: "Leave", exact: true }).click();
		await a.getByRole("button", { name: "Leave", exact: true }).click();
	} finally {
		for (const context of [first, second])
			for (const page of context.pages()) await leaveOnline(page);
		await first.close();
		await second.close();
	}
});
