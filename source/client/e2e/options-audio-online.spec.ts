import { expect, test } from "@playwright/test";
import {
	leaveOnline,
	newCommunity,
	observeOnline,
	registerOnline,
} from "./support/online";

test("Options keep sound, show controls and the game timer is always visible", async ({
	page,
}) => {
	test.skip(process.env.E2E_AUTH_ONLINE !== "true", "Requires backend/MySQL");
	await registerOnline(page, "options");
	await expect(
		page.getByText("Hold Space / W / ↑, then release", { exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Options", exact: true }).click();
	await expect(
		page.getByText("Hold Space / W / ↑, then release", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Controls", exact: true }),
	).toHaveCount(0);
	await expect(page.getByRole("switch", { name: /Display Timer/ })).toHaveCount(
		0,
	);
	await page.getByRole("switch", { name: "Sound: On", exact: true }).click();
	if (await page.evaluate(() => document.fullscreenEnabled)) {
		await page
			.getByRole("switch", { name: "Fullscreen: Off", exact: true })
			.click();
		await expect
			.poll(() => page.evaluate(() => document.fullscreenElement !== null))
			.toBe(true);
		await expect(
			page.getByRole("switch", { name: "Fullscreen: On", exact: true }),
		).toBeChecked();
		await page.evaluate(() => document.exitFullscreen());
		await expect(
			page.getByRole("switch", { name: "Fullscreen: Off", exact: true }),
		).not.toBeChecked();
	}
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await newCommunity(page);
	await expect(page.getByLabel("Play time", { exact: true })).toBeVisible();
	await expect(page.getByText(/^Jumps:/)).toHaveCount(0);
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	expect(
		await page
			.locator(".controls-help")
			.evaluate(
				(help) =>
					!!(
						document
							.querySelector(".game-overlay button:last-of-type")!
							.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING
					),
			),
	).toBe(true);
	const paused = await page
		.getByLabel("Play time", { exact: true })
		.textContent();
	await page.waitForTimeout(500);
	await expect(page.getByLabel("Play time", { exact: true })).toHaveText(
		paused!,
	);
	await page.getByRole("button", { name: "Options", exact: true }).click();
	await expect(
		page.getByRole("switch", { name: "Sound: Off", exact: true }),
	).toBeVisible();
	await leaveOnline(page);
});

test("native audio unlocks, decodes and caches effects and stops old ambience", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("jumpking.options", JSON.stringify({ sound: false })),
	);
	await page.goto("/");
	await page.evaluate(async () => {
		const module = "/src/game/presentation/AudioBus.ts";
		const { AudioBus } = await import(module);
		const manifest = await (await fetch("/assets/manifest.json")).json();
		const state = globalThis as unknown as {
			testAudio: InstanceType<typeof AudioBus>;
			audioErrors: string[];
		};
		state.audioErrors = [];
		state.testAudio = new AudioBus(manifest, true, (message: string) =>
			state.audioErrors.push(message),
		);
		state.testAudio.setScreen(0);
	});
	await page.keyboard.press("KeyX");
	const inspect = () =>
		page.evaluate(() => {
			const state = globalThis as unknown as {
				testAudio: {
					context: AudioContext;
					buffers: Map<string, AudioBuffer>;
					ambience: HTMLAudioElement[];
				};
				audioErrors: string[];
			};
			return {
				context: state.testAudio.context?.state,
				cache: state.testAudio.buffers.size,
				streams: state.testAudio.ambience.length,
				playing: state.testAudio.ambience.every(
					(audio) => !audio.paused && audio.readyState >= 2,
				),
				errors: state.audioErrors,
			};
		});
	await expect.poll(async () => (await inspect()).cache).toBeGreaterThan(10);
	await expect.poll(async () => (await inspect()).playing).toBe(true);
	expect((await inspect()).context).toBe("running");
	const result = await page.evaluate(() => {
		const { testAudio: audio } = globalThis as unknown as {
			testAudio: {
				buffers: Map<string, AudioBuffer>;
				ambience: HTMLAudioElement[];
				play: (key: string) => void;
				setEnabled: (value: boolean) => void;
				setScreen: (screen: number) => void;
				pause: (value: boolean) => void;
				dispose: () => void;
			};
		};
		const cache = audio.buffers.size,
			previous = [...audio.ambience];
		audio.play("audio/jump_king/king_jump");
		audio.pause(true);
		const paused = previous.every((stream) => stream.paused);
		audio.setEnabled(false);
		const cleared = audio.ambience.length === 0;
		audio.setEnabled(true);
		audio.setScreen(5);
		const oldStopped = previous.every(
			(stream) => stream.paused && !stream.getAttribute("src"),
		);
		const cacheRetained = audio.buffers.size === cache;
		audio.dispose();
		return { paused, cleared, oldStopped, cacheRetained };
	});
	expect(result).toEqual({
		paused: true,
		cleared: true,
		oldStopped: true,
		cacheRetained: true,
	});
	expect((await inspect()).errors).toEqual([]);
	await leaveOnline(page);
});

test("blocked audio reports a limitation without blocking the game", async ({
	page,
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, "AudioContext", {
			configurable: true,
			value: class {
				constructor() {
					throw new Error("Audio device unavailable");
				}
			},
		});
	});
	test.skip(process.env.E2E_AUTH_ONLINE !== "true", "Requires backend/MySQL");
	const observed = observeOnline(page);
	await registerOnline(page, "blocked_audio");
	await newCommunity(page);
	await expect(
		page.getByRole("button", { name: "Menu", exact: true }),
	).toBeVisible();
	await page.keyboard.down("Space");
	await expect
		.poll(() =>
			Promise.resolve(observed.snapshot?.self.simulation.physics.jumps),
		)
		.toBe(1);
	await page.keyboard.up("Space");
	await page.getByRole("button", { name: "Menu", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText(
		"Sound could not be played",
	);
	await page.getByRole("button", { name: "Options", exact: true }).click();
	await page.getByRole("switch", { name: "Sound: On", exact: true }).click();
	await expect(
		page.getByRole("switch", { name: "Sound: Off", exact: true }),
	).toBeVisible();
	await leaveOnline(page);
});
