import { expect, type Page, test } from "@playwright/test";
import type { GameSocket } from "../src/network/GameSocket";
import { required } from "../src/required";
import {
	leaveOnline,
	newCommunity,
	observeOnline,
	registerOnline,
} from "./support/online";

test.skip(
	process.env.E2E_SPECTATE_ONLINE !== "true",
	"Requires the isolated spectator integration harness",
);

type TestWindow = Window & {
	spectateSocket: GameSocket;
	releaseResume: () => void;
};

// Chỉ giữ tham chiếu socket hiện có để điều khiển mục tiêu mà không làm viewer mất focus.
async function captureSocket(page: Page) {
	await page.evaluate(async () => {
		const path = "/src/network/GameSocket.ts";
		const { GameSocket } = await import(path);
		const command = GameSocket.prototype.command;
		GameSocket.prototype.command = function (...args: unknown[]) {
			(window as unknown as TestWindow).spectateSocket = this;
			return command.apply(this, args);
		};
	});
}

async function pause(page: Page) {
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Resume", exact: true }),
	).toBeVisible();
}

async function holdResumeAck(page: Page) {
	await page.evaluate(() => {
		const socket = (window as unknown as TestWindow).spectateSocket;
		const command = socket.command.bind(socket);
		let held = false;
		const gate = new Promise<void>((resolve) => {
			(window as unknown as TestWindow).releaseResume = resolve;
		});
		socket.command = async (type, payload) => {
			const reply = await command(type, payload);
			if (
				!held &&
				type === "SET_COMMUNITY_PAUSED" &&
				payload?.paused === false
			) {
				held = true;
				await gate;
			}
			return reply;
		};
	});
}

for (const reason of ["Leave", "Disconnect", "Finish"] as const) {
	test(`Community pauses the viewer after target ${reason}, then resumes only on request`, async ({
		browser,
	}) => {
		const targetContext = await browser.newContext();
		const viewerContext = await browser.newContext();
		const target = await targetContext.newPage();
		const viewer = await viewerContext.newPage();
		const targetState = observeOnline(target),
			own = observeOnline(viewer);
		let runState:
			| { paused: boolean; pausePending: boolean; saveStatus: string }
			| undefined;
		const pauses: unknown[] = [];
		const errors: string[] = [];
		let targetFinished = false;
		viewer.on("pageerror", (e) => errors.push(e.message));
		viewer.on("websocket", (socket) => {
			socket.on("framesent", (frame) => {
				const m = JSON.parse(frame.payload.toString());
				if (m.type === "SET_COMMUNITY_PAUSED" && m.payload.paused)
					pauses.push(m);
			});
			socket.on("framereceived", (frame) => {
				const m = JSON.parse(frame.payload.toString());
				if (m.type === "COMMUNITY_RUN_STATE") runState = m.payload;
			});
		});
		target.on("websocket", (socket) =>
			socket.on("framereceived", (frame) => {
				const m = JSON.parse(frame.payload.toString());
				if (m.type === "PLAYER_FINISHED") targetFinished = true;
			}),
		);
		try {
			let targetName: string;
			if (reason === "Finish") {
				targetName = required(process.env.E2E_SPECTATE_FINISH_USERNAME);
				await target.goto("/sign-in");
				await target.getByLabel("Username", { exact: true }).fill(targetName);
				await target
					.getByLabel("Password", { exact: true })
					.fill("A secure server integration password");
				await target
					.getByRole("button", { name: "Sign In / Log In", exact: true })
					.click();
				await expect(
					target.getByRole("button", { name: targetName, exact: true }),
				).toBeVisible();
				await captureSocket(target);
				await target
					.getByRole("button", { name: "Continue", exact: true })
					.click();
				await expect(
					target.getByRole("button", { name: "Menu (Esc)", exact: true }),
				).toBeVisible();
			} else {
				targetName = await registerOnline(target, "loss_target");
				await captureSocket(target);
				await newCommunity(target);
			}
			await pause(target);
			await expect.poll(() => targetState.snapshot?.self.paused).toBe(true);
			const ownName = await registerOnline(viewer, "loss_viewer");
			await captureSocket(viewer);
			await newCommunity(viewer);
			await pause(viewer);
			await expect.poll(() => own.snapshot?.self.paused).toBe(true);
			await viewer.getByRole("button", { name: "Resume", exact: true }).click();
			await expect.poll(() => own.snapshot?.self.paused).toBe(false);
			const runId = required(own.snapshot).playId;
			const watch = viewer.getByRole("button", {
				name: `Watch ${targetName}`,
				exact: true,
			});
			await watch.click();
			await expect
				.poll(() => own.snapshot?.spectating?.player.nickname)
				.toBe(targetName);
			const beforeWatching = required(own.snapshot).elapsedTimeMs;
			await expect
				.poll(() => own.snapshot?.elapsedTimeMs ?? 0)
				.toBeGreaterThan(beforeWatching);
			if (reason === "Leave") {
				const previousPauses = pauses.length;
				const alternative = required(process.env.E2E_SPECTATE_ALTERNATIVE);
				await viewer
					.getByRole("button", { name: `Watch ${alternative}`, exact: true })
					.click();
				await expect
					.poll(() => own.snapshot?.spectating?.player.nickname)
					.toBe(alternative);
				await viewer
					.getByRole("button", { name: `Watch ${ownName}`, exact: true })
					.click();
				await expect.poll(() => own.snapshot?.spectating ?? null).toBeNull();
				await expect(
					viewer.getByRole("button", { name: "Resume", exact: true }),
				).toBeHidden();
				expect(pauses).toHaveLength(previousPauses);
				await watch.click();
				await expect
					.poll(() => own.snapshot?.spectating?.player.nickname)
					.toBe(targetName);
				await pause(viewer);
				await expect
					.poll(() => runState?.paused && !runState.pausePending)
					.toBe(true);
				await holdResumeAck(viewer);
				await viewer
					.getByRole("button", { name: "Resume", exact: true })
					.click();
				await expect.poll(() => runState?.paused).toBe(false);
			}
			const pausesBeforeLoss = pauses.length;
			await target.evaluate(async (cause) => {
				const socket = (window as unknown as TestWindow).spectateSocket;
				if (cause === "Leave") await socket.command("LEAVE_ROOM");
				else if (cause === "Disconnect") socket.close();
				else {
					await socket.command("SET_COMMUNITY_PAUSED", { paused: false });
					socket.input("PLAYER_INPUT", {
						...socket.playContext,
						seq: 1,
						left: false,
						right: false,
						jump: false,
						freeFlight: false,
					});
				}
			}, reason);
			await expect(
				viewer.getByRole("button", { name: "Resume", exact: true }),
			).toBeVisible();
			await expect.poll(() => own.snapshot?.spectating ?? null).toBeNull();
			await expect
				.poll(
					() =>
						runState?.paused &&
						!runState.pausePending &&
						runState.saveStatus === "SAVED",
				)
				.toBe(true);
			await expect.poll(() => pauses.length).toBe(pausesBeforeLoss + 1);
			if (reason === "Finish")
				await expect.poll(() => targetFinished).toBe(true);
			if (reason === "Leave")
				await viewer.evaluate(() =>
					(window as unknown as TestWindow).releaseResume(),
				);
			const resume = viewer.getByRole("button", {
				name: "Resume",
				exact: true,
			});
			await expect(resume).toBeEnabled();
			const saved = await (
				await viewer.request.get("/api/community/current")
			).json();
			const elapsed = saved.run.elapsedTimeMs;
			const position = required(own.snapshot).self.simulation.physics;
			// Khoảng quan sát để phát hiện timer vẫn chạy sau khi server xác nhận Pause ổn định.
			await viewer.waitForTimeout(400);
			const stillPaused = await (
				await viewer.request.get("/api/community/current")
			).json();
			expect(stillPaused.run.elapsedTimeMs).toBe(elapsed);
			expect(required(own.snapshot).elapsedTimeMs).toBe(elapsed);
			expect(required(own.snapshot).self.simulation.physics).toEqual(position);
			expect(pauses).toHaveLength(pausesBeforeLoss + 1);
			await expect(resume).toBeVisible();
			await resume.click();
			await expect.poll(() => own.snapshot?.self.paused).toBe(false);
			await expect
				.poll(() => own.snapshot?.elapsedTimeMs ?? 0)
				.toBeGreaterThan(elapsed);
			expect(required(own.snapshot).playId).toBe(runId);
			expect(required(own.snapshot).spectating).toBeNull();
			expect(required(own.snapshot).self.simulation.physics.x).toBe(position.x);
			expect(required(own.snapshot).self.simulation.physics.y).toBe(position.y);
			expect(errors).toEqual([]);
		} finally {
			await leaveOnline(viewer);
			await leaveOnline(target);
			await viewerContext.close();
			await targetContext.close();
		}
	});
}
