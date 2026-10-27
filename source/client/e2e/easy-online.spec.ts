import { expect, test } from "@playwright/test";
import { required } from "../src/required";
import {
	createRoom,
	joinRoom,
	leaveOnline,
	observeOnline,
	registerOnline,
	startRoom,
} from "./support/online";

test.skip(
	process.env.E2E_AUTH_ONLINE !== "true",
	"Requires isolated backend/MySQL",
);

test("Easy returns only the falling player to their last safe platform and resets on Play Again", async ({
	browser,
}, info) => {
	test.setTimeout(90000);
	const first = await browser.newContext(),
		second = await browser.newContext();
	const a = await first.newPage(),
		b = await second.newPage(),
		own = observeOnline(a),
		peer = observeOnline(b),
		errors: string[] = [];
	for (const page of [a, b])
		page.on("pageerror", (error) => errors.push(error.message));
	try {
		const name = await registerOnline(a, "easy_host");
		await registerOnline(b, "easy_peer");
		await a.evaluate(async () => {
			const path = "/src/network/GameSocket.ts";
			const { GameSocket } = await import(path),
				connect = GameSocket.prototype.connect;
			GameSocket.prototype.connect = function () {
				Object.assign(window, { easyConnection: this });
				return connect.call(this);
			};
		});
		const id = await createRoom(a);
		await joinRoom(b, id);
		await a.getByLabel("Mode", { exact: true }).selectOption("EASY");
		await expect(b.getByLabel("Mode", { exact: true })).toHaveValue("EASY");
		await startRoom(a, b);
		await expect
			.poll(() => own.snapshot?.self.simulation.physics.grounded)
			.toBe(true);
		await expect
			.poll(() => peer.snapshot?.self.simulation.world.safePosition)
			.toBeDefined();
		const spawn = structuredClone(
			required(required(own.snapshot).self.simulation.world.safePosition),
		);
		const fullJump = async (direction: string, jumps: number) => {
			await a.keyboard.down(direction);
			await a.keyboard.down("Space");
			await expect
				.poll(() => own.snapshot?.self.simulation.physics.jumps)
				.toBe(jumps);
			const takeoff = structuredClone(
				required(required(own.snapshot).self.simulation.world.safePosition),
			);
			await a.keyboard.up("Space");
			await a.keyboard.up(direction);
			await expect
				.poll(() => own.snapshot?.self.simulation.physics.grounded)
				.toBe(true);
			return takeoff;
		};
		// Leo hai bệ đầu bằng input thật; cú nhảy hụt sau đó rơi đủ mạnh để SPLAT.
		await fullJump("ArrowLeft", 1);
		await expect
			.poll(() => own.snapshot?.self.simulation.world.safePosition?.y)
			.toBe(158);
		await a.keyboard.down("ArrowLeft");
		await expect
			.poll(() => own.snapshot?.self.simulation.physics.x, {
				intervals: [20],
			})
			.toBeLessThan(50);
		await a.keyboard.up("ArrowLeft");
		await fullJump("ArrowRight", 2);
		await expect
			.poll(() => own.snapshot?.self.simulation.world.safePosition?.y)
			.toBe(14);
		const elapsed = required(own.snapshot).elapsedTimeMs;
		const safe = await fullJump("ArrowLeft", 3);
		expect(safe.y).toBe(14);
		await expect
			.poll(() => own.snapshot?.self.simulation.physics.falls)
			.toBe(1);
		await expect
			.poll(() => own.snapshot?.self.simulation.physics)
			.toMatchObject({ ...safe, vx: 0, charge: 0, splat: 0, jumps: 3 });
		expect(required(own.snapshot).self.simulation.world.safePosition).toEqual(
			safe,
		);
		expect(required(own.snapshot).elapsedTimeMs).toBeGreaterThan(elapsed);
		await expect
			.poll(() => peer.snapshot?.self.simulation.world.safePosition)
			.toEqual(spawn);
		expect(required(peer.snapshot).self.simulation.physics.falls).toBe(0);
		await expect
			.poll(
				() =>
					peer.snapshot?.peers.find((player) => player.nickname === name)
						?.state,
			)
			.toMatchObject(safe);
		await a.screenshot({ path: info.outputPath("easy-return.png") });
		const disconnectedAt = required(own.snapshot).self.simulation.physics.ticks;
		await a.evaluate(() => {
			const connection = (
				window as unknown as { easyConnection: { socket: WebSocket } }
			).easyConnection;
			connection.socket.close(4000, "Test Easy reconnect");
		});
		await a.getByRole("button", { name: "Reconnect", exact: true }).click();
		await a.getByRole("button", { name: "Resume", exact: true }).click();
		await expect
			.poll(() => own.snapshot?.self.simulation.physics.ticks)
			.toBeGreaterThan(disconnectedAt);
		await expect
			.poll(() => own.snapshot?.self.simulation.world.safePosition)
			.toEqual(safe);
		await b.bringToFront();
		if (
			!(await b
				.getByRole("button", { name: "End Match", exact: true })
				.isVisible())
		)
			await b.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
		await b.getByRole("button", { name: "End Match", exact: true }).click();
		await expect(a.getByText("Results saved", { exact: true })).toBeVisible();
		const run = (await (await a.request.get("/api/history")).json()).items[0];
		expect(run.room.mode).toBe("EASY");
		const detail = await (
			await a.request.get(`/api/history/ROOM/${run.id}`)
		).json();
		expect(
			detail.participants.find(
				(player: { username: string }) => player.username === name,
			),
		).toMatchObject({ jumps: 3, falls: 1 });
		await a.getByRole("button", { name: "Play Again", exact: true }).click();
		await b.getByRole("button", { name: "Play Again", exact: true }).click();
		await expect(a.getByLabel("Mode", { exact: true })).toHaveValue("EASY");
		await startRoom(b, a);
		await expect.poll(() => own.snapshot?.playId).not.toBe(run.id);
		await expect
			.poll(() => own.snapshot?.self.simulation.world.safePosition)
			.toEqual(spawn);
		expect(required(own.snapshot).self.simulation.physics).toMatchObject({
			jumps: 0,
			falls: 0,
		});
		expect(errors).toEqual([]);
	} finally {
		for (const key of ["Space", "ArrowLeft", "ArrowRight"])
			await a.keyboard.up(key);
		await leaveOnline(a);
		await leaveOnline(b);
		await first.close();
		await second.close();
	}
});
