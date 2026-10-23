import { expect, test } from "@playwright/test";
import { leaveOnline, newCommunity, registerOnline } from "./support/online";

test.skip(process.env.E2E_AUTH_ONLINE !== "true", "Requires backend/MySQL");
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
});
test.afterEach(async ({ page }) => {
	await leaveOnline(page);
});

test("expired reconnect returns home and Continue restores the last server checkpoint", async ({
	page,
}) => {
	await registerOnline(page, "reconnect_end");
	await newCommunity(page);
	const run = (await (await page.request.get("/api/community/current")).json())
		.run.id;
	await page.evaluate(async () => {
		const path = "/src/network/GameSocket.ts";
		const { GameSocket } = await import(path);
		const original = GameSocket.prototype.input;
		GameSocket.prototype.input = function (
			type: "PLAYER_INPUT" | "CANCEL_INPUT",
			payload: Record<string, unknown>,
		) {
			GameSocket.prototype.input = original;
			original.call(this, type, payload);
			this.fail("Disconnected for membership expiry test");
		};
	});
	await expect(
		page.getByRole("heading", { name: "Disconnected", exact: true }),
	).toBeVisible();
	await page.evaluate(async () => {
		const gamePath = "/src/network/GameSocket.ts",
			storagePath = "/src/network/reconnect.ts",
			apiPath = "/src/network/api.ts";
		const { GameSocket } = await import(gamePath);
		const { loadReconnect } = await import(storagePath);
		const { backendOrigin } = await import(apiPath);
		const me = await (await fetch("/api/auth/me")).json();
		const context = await loadReconnect(
			`${backendOrigin()}:account:${me.account.id}`,
		);
		if (!context) throw new Error("Expected stored reconnect context");
		const connection = new GameSocket(
			() => {},
			() => {},
		);
		try {
			await connection.connect();
			// Kết thúc membership thật qua kết nối khác, giữ context cũ của UI để thử token hết hạn.
			await connection.command("RECONNECT", context);
			await connection.command("LEAVE_ROOM");
		} finally {
			connection.close();
		}
	});
	await page.getByRole("button", { name: "Reconnect", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Continue", exact: true }),
	).toBeEnabled();
	await expect(page.locator("canvas")).toHaveCount(0);
	await expect(
		page.getByRole("status").filter({ hasText: /room/i }),
	).not.toContainText(/was saved|being away too long/);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Menu (Esc)", exact: true }),
	).toBeVisible();
	expect(
		(await (await page.request.get("/api/community/current")).json()).run.id,
	).toBe(run);
});

for (const scenario of [
	"server-removal",
	"pause-rejected",
	"resume-rejected",
]) {
	test(`${scenario} returns home without reloading and Continue restores the same run`, async ({
		page,
	}) => {
		let armed = false;
		await page.routeWebSocket("**/ws/game", (socket) => {
			const server = socket.connectToServer();
			let rejectedRequest: string | undefined;
			socket.onMessage((data) => {
				const message = JSON.parse(data.toString());
				if (
					armed &&
					message.type === "SET_COMMUNITY_PAUSED" &&
					message.payload.paused === (scenario !== "resume-rejected")
				) {
					armed = false;
					rejectedRequest = message.requestId;
					// Server thật lưu/release membership; mô phỏng thông báo kick hoặc mất thông báo.
					server.send(
						JSON.stringify({
							...message,
							type: "LEAVE_ROOM",
							requestId: "test-membership-ended",
							payload: {},
						}),
					);
				} else server.send(data);
			});
			server.onMessage((data) => {
				const message = JSON.parse(data.toString());
				if (
					message.type === "ROOM_LEFT" &&
					message.requestId === "test-membership-ended"
				) {
					if (scenario === "server-removal") {
						delete message.requestId;
						socket.send(JSON.stringify(message));
					} else
						socket.send(
							JSON.stringify({
								v: 1,
								type: "ERROR",
								requestId: rejectedRequest,
								payload: {
									code: "INVALID_MESSAGE",
									message:
										"This command is not available in the current context",
								},
							}),
						);
				} else socket.send(data);
			});
		});
		const name = await registerOnline(page, "expired");
		await newCommunity(page);
		const run = (
			await (await page.request.get("/api/community/current")).json()
		).run.id;
		armed = true;
		await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		if (scenario === "resume-rejected")
			await page.getByRole("button", { name: "Resume", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Continue", exact: true }),
		).toBeEnabled();
		await expect(page.locator("canvas")).toHaveCount(0);
		await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
		const notice = page.getByRole("status").filter({ hasText: /room/i });
		await expect(notice).toBeVisible();
		await expect(notice).not.toContainText(/was saved|being away too long/);
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Menu (Esc)", exact: true }),
		).toBeVisible();
		expect(
			(await (await page.request.get("/api/community/current")).json()).run.id,
		).toBe(run);
	});
}
