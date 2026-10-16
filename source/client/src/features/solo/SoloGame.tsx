import { useCallback, useEffect, useRef, useState } from "react";
import rules from "../../../../common/rules.json";
import { ControlsHelp } from "../../components/ControlsHelp";
import { MenuPanel } from "../../components/MenuPanel";
import { loadManifest } from "../../game/content/assets";
import { FlightToggle } from "../../game/input/FlightToggle";
import { InputController } from "../../game/input/InputController";
import { TouchControls } from "../../game/input/TouchControls";
import { AudioBus } from "../../game/presentation/AudioBus";
import { PRESENTATION } from "../../game/presentation/config";
import { parseMap } from "../../game/simulation/map";
import type { PlayerState } from "../../game/simulation/types";
import { api } from "../../network/api";
import type { GameConfig } from "../../network/contracts";
import { duration, ticksToMs } from "../records/format";
import { OptionsButtons } from "../settings/OptionsPanel";
import { type Options, readOptions, saveOptions } from "../settings/options";
import { SoloRuntime } from "./SoloRuntime";
import { notifySoloSaved, SoloWriter, StorageUnavailable } from "./storage";

export function SoloGame({
	profile = "guest",
	action = "auto",
	expectedRunId = null,
	onExit,
}: {
	profile?: string;
	action?: "new" | "continue" | "auto";
	expectedRunId?: string | null;
	onExit?: () => void;
}) {
	const container = useRef<HTMLElement>(null);
	const runtime = useRef<SoloRuntime | null>(null);
	const input = useRef<InputController | null>(null);
	const writer = useRef<SoloWriter | null>(null);
	const pauseRequested = useRef(false);
	const closing = useRef(false);
	const audio = useRef<AudioBus | null>(null);
	const [options, setOptions] = useState(readOptions);
	const [menu, setMenu] = useState<"pause" | "options">("pause");
	const [optionError, setOptionError] = useState("");
	const [ending, setEnding] = useState<"playing" | "picture" | null>(null);
	const [pictureReady, setPictureReady] = useState(false);
	const skipEnding = useRef<(() => void) | null>(null);
	const flight = useRef<FlightToggle | null>(null);
	useEffect(() => {
		if (ending !== "picture") return;
		const timer = setTimeout(
			() => setPictureReady(true),
			PRESENTATION.endingPictureGuardMs,
		);
		return () => clearTimeout(timer);
	}, [ending]);
	const [state, setState] = useState<PlayerState | null>(null);
	const [error, setError] = useState("");
	const [ready, setReady] = useState(false);
	const [paused, setPaused] = useState(false);
	const [saveStatus, setSaveStatus] = useState<"SAVED" | "PENDING" | "FAILED">(
		"PENDING",
	);
	const [saveError, setSaveError] = useState("");
	const [leaving, setLeaving] = useState(false);
	const flush = useCallback(async () => {
		const session = runtime.current,
			storage = writer.current;
		if (!session || !storage) return;
		storage.observe(
			session.game.snapshot(),
			session.simulation.map.progressOriginY,
			session.simulation.finished,
		);
		setSaveStatus("PENDING");
		try {
			await storage.save();
			setSaveStatus("SAVED");
			setSaveError("");
		} catch (cause) {
			session.pause();
			input.current?.cancel();
			setPaused(true);
			setSaveStatus("FAILED");
			setSaveError(
				cause instanceof Error ? cause.message : "Could not save Solo",
			);
			throw cause;
		}
	}, []);
	const pause = useCallback(() => {
		if (runtime.current?.simulation.finished) {
			skipEnding.current?.();
			return;
		}
		pauseRequested.current = true;
		runtime.current?.pause();
		audio.current?.pause(true);
		flight.current?.cancel();
		input.current?.cancel();
		setMenu("pause");
		setPaused(true);
		void flush()
			.then(() => notifySoloSaved(profile, true))
			.catch(() => {});
	}, [flush, profile]);
	const updateOptions = (key: keyof Options) => {
		const next = { ...options, [key]: !options[key] };
		setOptions(next);
		audio.current?.setEnabled(next.sound);
		try {
			saveOptions(next);
			setOptionError("");
		} catch {
			setOptionError("Options could not be saved on this device");
		}
	};
	useEffect(() => {
		const controller = new AbortController();
		let disposed = false;
		let game: { destroy(removeCanvas: boolean): void } | undefined;
		let lastHud = 0;
		let lastActivity = performance.now();
		const activity = () => {
			lastActivity = performance.now();
		};
		const controls = new InputController(
			activity,
			pause,
			() => {
				runtime.current?.simulation.cancelInput();
				flight.current?.cancel();
			},
			(now) => flight.current?.press(now),
		);
		input.current = controls;
		const hidden = () => {
			if (document.hidden) pause();
		};
		window.addEventListener("blur", pause);
		document.addEventListener("visibilitychange", hidden);
		const afk = window.setInterval(() => {
			if (
				runtime.current &&
				!runtime.current.paused &&
				performance.now() - lastActivity >= rules.afkMs
			)
				pause();
		}, PRESENTATION.afkPollMs);
		const autosave = window.setInterval(() => {
			if (!closing.current) void flush().catch(() => {});
		}, rules.soloSaveMs);
		const pageHide = () => {
			closing.current = true;
			pause();
			void flush()
				.then(() => writer.current?.close())
				.catch(() => {});
		};
		const pageShow = (event: PageTransitionEvent) => {
			if (event.persisted) location.reload();
		};
		window.addEventListener("pagehide", pageHide);
		window.addEventListener("pageshow", pageShow);
		void (async () => {
			const [renderer, manifest, response, flyAllowed] = await Promise.all([
				import("../../game/presentation/createGame"),
				loadManifest(controller.signal),
				fetch("/shared/maps/main-babe.json", { signal: controller.signal }),
				api<GameConfig>("/game-config")
					.then((config) => config.features.flyEnabled === true)
					.catch(() => false),
			]);
			if (!response.ok) throw new Error("Game map is unavailable");
			const map = parseMap(await response.json());
			if (disposed) return;
			audio.current = new AudioBus(
				manifest,
				readOptions().sound,
				setOptionError,
			);
			let finished = false;
			let savedScreen = 0;
			const session = new SoloRuntime(
				map,
				flyAllowed,
				() => controls.read(),
				(frame) => {
					audio.current?.setScreen(frame.screen);
					writer.current?.observe(
						session.game.snapshot(),
						map.progressOriginY,
						session.simulation.finished,
					);
					if (frame.screen !== savedScreen) {
						savedScreen = frame.screen;
						void flush().catch(() => {});
					}
					if (session.simulation.finished && !finished) {
						finished = true;
						controls.cancel();
						void flush().catch(() => {});
					}
					const now = performance.now();
					if (now - lastHud >= PRESENTATION.hudIntervalMs) {
						setState(frame);
						lastHud = now;
					}
				},
				"Player",
				(effects, frame) => {
					for (const effect of effects) audio.current?.effect(effect, frame);
				},
				(events, world) => {
					if (events.length) audio.current?.play("audio/talking");
					for (const event of world)
						audio.current?.play(
							event.type === "JINGLE"
								? "audio/music/event_music/ending_jingle"
								: manifest.walls.find((wall) => wall.id === event.id)
										?.appearSound || "audio/illusion",
						);
				},
			);
			const storage = await SoloWriter.open(
				profile,
				action,
				session.game.snapshot(),
				expectedRunId,
			).catch((cause) => {
				if (
					cause instanceof StorageUnavailable &&
					action !== "continue" &&
					expectedRunId === null
				) {
					setSaveStatus("FAILED");
					setSaveError(cause.message);
					return null;
				}
				throw cause;
			});
			if (disposed) {
				await storage?.close();
				return;
			}
			try {
				if (storage?.run.snapshot) {
					session.restore(storage.run.snapshot);
					savedScreen = storage.run.snapshot.physics.screen;
				}
			} catch (cause) {
				await storage?.close();
				throw cause;
			}
			writer.current = storage;
			runtime.current = session;
			flight.current = new FlightToggle(
				flyAllowed,
				() => session.simulation.snapshot().freeFlight,
				(enabled) => session.simulation.setFlight(enabled),
			);
			audio.current.setScreen(session.simulation.snapshot().screen);
			if (pauseRequested.current) {
				session.pause();
				controls.cancel();
				audio.current.pause(true);
			}
			if (storage) setSaveStatus("SAVED");
			activity();
			game = renderer.createGame(
				container.current!,
				manifest,
				session,
				() => {
					setReady(true);
					setState(session.simulation.snapshot());
				},
				(message) => {
					session.pause();
					controls.cancel();
					setError(message);
				},
				{
					onEndingStart: (skip) => {
						skipEnding.current = skip;
						controls.cancel();
						setPaused(false);
						setEnding("playing");
						audio.current?.beginEnding();
					},
					onEndingComplete: () => setEnding("picture"),
					onSound: (key) => audio.current?.play(key),
				},
			);
		})().catch((cause) => {
			if (!disposed)
				setError(
					cause instanceof Error ? cause.message : "Unable to load game",
				);
		});
		return () => {
			disposed = true;
			controller.abort();
			clearInterval(afk);
			clearInterval(autosave);
			const storage = writer.current,
				session = runtime.current;
			if (storage && session) {
				session.pause();
				storage.observe(
					session.game.snapshot(),
					session.simulation.map.progressOriginY,
					session.simulation.finished,
				);
				void storage
					.save()
					.finally(() => storage.close())
					.catch(() => {});
			}
			writer.current = null;
			controls.dispose();
			game?.destroy(true);
			audio.current?.dispose();
			audio.current = null;
			runtime.current = null;
			input.current = null;
			flight.current = null;
			window.removeEventListener("blur", pause);
			document.removeEventListener("visibilitychange", hidden);
			window.removeEventListener("pagehide", pageHide);
			window.removeEventListener("pageshow", pageShow);
		};
	}, [profile, action, expectedRunId, pause, flush]);
	const leave = async () => {
		if (leaving) return;
		if (!writer.current && !window.confirm("Leave without saving this game?"))
			return;
		closing.current = true;
		pause();
		setLeaving(true);
		try {
			await flush();
			await writer.current?.close();
			writer.current = null;
			if (onExit) onExit();
			else location.href = "/";
		} catch {
			closing.current = false;
			setLeaving(false);
		}
	};
	const discardUnsaved = async () => {
		if (
			leaving ||
			!window.confirm("Leave without saving your latest progress?")
		)
			return;
		closing.current = true;
		runtime.current?.pause();
		input.current?.cancel();
		setLeaving(true);
		try {
			await writer.current?.close();
		} catch {
			/* Giải phóng phiên ngay cả khi storage không còn truy cập được. */
		}
		writer.current = null;
		if (onExit) onExit();
		else location.href = "/";
	};
	return (
		<main className="play-page">
			<section
				className="game-viewport"
				ref={container}
				aria-label="Main Babe game"
			/>
			{!ready && !error && (
				<p className="game-message" role="status">
					Loading…
				</p>
			)}
			{error && (
				<div className="game-message" role="alert">
					<p>{error}</p>
					<button
						type="button"
						onClick={() => {
							void (async () => {
								try {
									await writer.current?.close();
								} catch {}
								writer.current = null;
								if (onExit) onExit();
								else location.href = "/";
							})();
						}}
					>
						Back
					</button>
				</div>
			)}
			{saveError && (
				<p className="save-error" role="alert">
					{saveError}
				</p>
			)}
			{ready && !ending && (
				<div className="game-hud">
					<span>
						{
							<span className="timer" role="timer" aria-label="Play time">
								{duration(ticksToMs(state?.ticks || 0))}
							</span>
						}
					</span>
					<button type="button" onClick={pause}>
						Menu
					</button>
				</div>
			)}
			{ready && !paused && !ending && (
				<TouchControls input={input} flying={state?.freeFlight} />
			)}
			{ending && (
				<div className="ending-actions">
					{ending === "playing" ? (
						<button type="button" onClick={() => skipEnding.current?.()}>
							Skip
						</button>
					) : (
						<button
							type="button"
							disabled={!pictureReady || leaving}
							onClick={() => {
								void leave();
							}}
						>
							{leaving ? "Saving…" : "Back to Menu"}
						</button>
					)}
				</div>
			)}
			{paused && (
				<section className="game-overlay" aria-label="Game menu">
					<MenuPanel
						title={
							menu === "pause"
								? "Paused"
								: menu === "options"
									? "Options"
									: "Controls"
						}
						onBack={menu === "pause" ? undefined : () => setMenu("pause")}
					>
						{menu === "pause" && (
							<>
								<button
									type="button"
									disabled={leaving}
									onClick={() => {
										pauseRequested.current = false;
										input.current?.resume();
										runtime.current?.resume();
										audio.current?.pause(false);
										setPaused(false);
									}}
								>
									Resume
								</button>
								<button type="button" onClick={() => setMenu("options")}>
									Options
								</button>
								<button
									type="button"
									disabled={leaving}
									onClick={() => {
										void leave();
									}}
								>
									{leaving ? "Saving…" : "Save & Exit"}
								</button>
								{saveStatus === "FAILED" && (
									<button
										type="button"
										disabled={leaving}
										onClick={() => {
											void discardUnsaved();
										}}
									>
										Leave Without Saving
									</button>
								)}
								<small role="status">
									{saveStatus === "SAVED"
										? "Saved"
										: saveStatus === "PENDING"
											? "Saving…"
											: "Save failed"}
								</small>
								<ControlsHelp />
							</>
						)}
						{menu === "options" && (
							<OptionsButtons
								options={options}
								onChange={updateOptions}
								onError={setOptionError}
							/>
						)}
						{optionError && <p role="alert">{optionError}</p>}
					</MenuPanel>
				</section>
			)}
		</main>
	);
}
