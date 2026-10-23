import { expect, test } from "@playwright/test";
import { required } from "../src/required";
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
	await expect(page.locator(".controls-help dt")).toHaveText(["Move", "Jump"]);
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
	const region = page.getByLabel("Current region", { exact: true });
	await expect(region).toHaveText("REDCROWN WOODS");
	await expect(region).toHaveCSS("animation-duration", "6s");
	await expect(region).toHaveCSS("pointer-events", "none");
	await expect
		.poll(() =>
			region.evaluate((element) => Number(getComputedStyle(element).opacity)),
		)
		.toBeGreaterThan(0);
	await region.evaluate((element) => {
		element.setAttribute("data-same-region", "retained");
	});
	await expect(page.getByText(/^Jumps:/)).toHaveCount(0);
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
	await expect(page.locator(".controls-help dt")).toHaveText(["Move", "Jump"]);
	await expect(region).toBeHidden();
	await expect(region).toHaveCSS("animation-play-state", "paused");
	await expect(region).toHaveAttribute("data-same-region", "retained");
	expect(
		await page.locator(".controls-help").evaluate((help) => {
			const button = document.querySelector(
				".game-overlay button:last-of-type",
			);
			return (
				!!button &&
				!!(
					button.compareDocumentPosition(help) &
					Node.DOCUMENT_POSITION_FOLLOWING
				)
			);
		}),
	).toBe(true);
	const paused = await page
		.getByLabel("Play time", { exact: true })
		.textContent();
	const captionTime = await region.evaluate((element) =>
		Number(element.getAnimations()[0]?.currentTime),
	);
	await page.waitForTimeout(500);
	expect(
		await region.evaluate((element) =>
			Number(element.getAnimations()[0]?.currentTime),
		),
	).toBe(captionTime);
	await expect(page.getByLabel("Play time", { exact: true })).toHaveText(
		required(paused),
	);
	await page.getByRole("button", { name: "Resume", exact: true }).click();
	await expect(region).toBeVisible();
	await expect(region).toHaveCSS("animation-play-state", "running");
	expect(
		await region.evaluate((element) =>
			Number(element.getAnimations()[0]?.currentTime),
		),
	).toBeGreaterThanOrEqual(captionTime);
	await expect(region).toHaveAttribute("data-same-region", "retained");
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
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
	// Effects đã giải mã trước thao tác mở khóa, cú nhảy đầu không phải chờ tải.
	await expect.poll(async () => (await inspect()).cache).toBeGreaterThan(10);
	await page.keyboard.press("KeyX");
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
		page.getByRole("button", { name: "Menu (Esc)", exact: true }),
	).toBeVisible();
	await page.keyboard.down("Space");
	await expect
		.poll(() =>
			Promise.resolve(observed.snapshot?.self.simulation.physics.jumps),
		)
		.toBe(1);
	await page.keyboard.up("Space");
	await page.getByRole("button", { name: "Menu (Esc)", exact: true }).click();
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
