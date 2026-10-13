import { expect, test } from "@playwright/test";
import checkpoints from "../../common/fixtures/main-babe-checkpoints.json" with {
	type: "json",
};

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires the isolated backend/MySQL integration harness",
);

test("Solo crown syncs to the Account and a new device without importing the checkpoint", async ({
	browser,
}) => {
	const first = await browser.newContext(),
		second = await browser.newContext();
	try {
		const a = await first.newPage(),
			b = await second.newPage();
		const username = "crown_" + Date.now(),
			password = "A secure crown password";
		await a.goto("/");
		await a
			.getByRole("button", { name: "Create Account", exact: true })
			.click();
		await a.getByLabel("Username", { exact: true }).fill(username);
		await a.getByLabel("Password", { exact: true }).fill(password);
		await a
			.getByRole("button", { name: "Create Account", exact: true })
			.click();
		await expect(
			a.getByRole("button", { name: username, exact: true }),
		).toBeVisible();
		await a.evaluate(async (physics) => {
			const storage = "/src/features/solo/storage.ts",
				simulation = "/src/game/simulation/GameSimulation.ts";
			const { SoloWriter } = await import(storage),
				{ GameSimulation } = await import(simulation);
			const me = await (await fetch("/api/auth/me")).json(),
				map = await (await fetch("/shared/maps/main-babe.json")).json();
			const game = new GameSimulation(map);
			game.physics.restore(physics);
			const snapshot = game.snapshot();
			snapshot.world.lastTick = physics.ticks;
			const writer = await SoloWriter.open(
				location.origin + ":account:" + me.account.id,
				"new",
				snapshot,
			);
			await writer.close();
		}, checkpoints.at(-1)!);
		await a.reload();
		await a.getByRole("button", { name: "Continue Solo", exact: true }).click();
		await a.getByRole("button", { name: "Skip", exact: true }).click();
		await a.getByRole("button", { name: "Back to Menu", exact: true }).click();
		await expect
			.poll(
				async () =>
					(await (await a.request.get("/api/auth/me")).json()).account
						.crownUnlocked,
			)
			.toBe(true);
		await b.goto("/");
		await b.getByRole("button", { name: "Sign In", exact: true }).click();
		await b.getByLabel("Username", { exact: true }).fill(username);
		await b.getByLabel("Password", { exact: true }).fill(password);
		await b.getByRole("button", { name: "Sign In", exact: true }).click();
		await expect(
			b.getByRole("button", { name: username, exact: true }),
		).toBeVisible();
		await expect(
			b.getByRole("button", { name: "Continue Solo", exact: true }),
		).toHaveCount(0);
		await b.getByRole("button", { name: "New Solo Game", exact: true }).click();
		await b.getByRole("button", { name: "Menu", exact: true }).click();
		const saved = await b.evaluate(async () => {
			const path = "/src/features/solo/storage.ts",
				{ currentSolo } = await import(path);
			const me = await (await fetch("/api/auth/me")).json();
			return currentSolo(location.origin + ":account:" + me.account.id);
		});
		expect(saved.snapshot.adventure.flags).toContain("CompletedNormalGame");
		expect(saved.playTicks).toBeLessThan(1000);
		await b.getByRole("button", { name: "Save & Exit", exact: true }).click();
	} finally {
		await first.close();
		await second.close();
	}
});
