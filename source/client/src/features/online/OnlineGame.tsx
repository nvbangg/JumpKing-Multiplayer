import { useEffect, useRef, useState } from "react";
import rules from "../../../../common/rules.json";
import { ControlsHelp } from "../../components/ControlsHelp";
import { MenuPanel } from "../../components/MenuPanel";
import { loadManifest } from "../../game/content/assets";
import { FlightToggle } from "../../game/input/FlightToggle";
import { InputController } from "../../game/input/InputController";
import { TouchControls } from "../../game/input/TouchControls";
import { AdventureEffects } from "../../game/netcode/AdventureEffects";
import { OnlineRuntime } from "../../game/netcode/OnlineRuntime";
import { PlayerEffects } from "../../game/netcode/PlayerEffects";
import { AudioBus } from "../../game/presentation/AudioBus";
import { PRESENTATION } from "../../game/presentation/config";
import { parseMap } from "../../game/simulation/map";
import { api } from "../../network/api";
import type { PlayerStanding } from "../../network/contracts";
import type { GameSocket, RoomState } from "../../network/GameSocket";
import { InGameLeaderboard } from "../community/InGameLeaderboard";
import { duration } from "../records/format";
import { ChatOverlay } from "../rooms/ChatOverlay";
import { PlayersPanel } from "../rooms/PlayersPanel";
import { useRoomChat } from "../rooms/useRoomChat";
import { OptionsButtons } from "../settings/OptionsPanel";
import { type Options, readOptions, saveOptions } from "../settings/options";

export function OnlineGame({
	socket,
	room,
	onHome,
	onResults,
}: {
	socket: GameSocket;
	room: RoomState;
	onHome: () => void;
	onResults: () => void;
}) {
	const container = useRef<HTMLElement>(null),
		runtime = useRef<OnlineRuntime | null>(null),
		input = useRef<InputController | null>(null),
		audio = useRef<AudioBus | null>(null);
	const [countdown, setCountdown] = useState<number | null>(null);
	const [ready, setReady] = useState(false),
		[menu, setMenu] = useState<"pause" | "options" | null>(null);
	const flight = useRef<FlightToggle | null>(null);
	const [flying, setFlying] = useState(false);
	const [options, setOptions] = useState(readOptions);
	const [error, setError] = useState(""),
		[pending, setPending] = useState(false),
		[elapsed, setElapsed] = useState(0),
		[saveStatus, setSaveStatus] = useState("SAVED");
	const [remaining, setRemaining] = useState<number | null>(null);
	const [players, setPlayers] = useState<PlayerStanding[]>([]);
	const [disconnected, setDisconnected] = useState(false);
	const [ending, setEnding] = useState<"playing" | "picture" | null>(null),
		[pictureReady, setPictureReady] = useState(false);
	const endingActive = useRef(false),
		skipEnding = useRef<(() => void) | null>(null);
	const chat = useRoomChat(
		socket,
		ready && !ending,
		() => {
			runtime.current?.cancel();
			flight.current?.cancel();
			input.current?.cancel();
		},
		() => {
			if (!runtime.current?.menu && !endingActive.current)
				input.current?.resume();
		},
	);
	useEffect(() => {
		if (ending !== "picture") return;
		const timer = setTimeout(
			() => setPictureReady(true),
			PRESENTATION.endingPictureGuardMs,
		);
		return () => clearTimeout(timer);
	}, [ending]);
	const latestRoom = useRef(room);
	latestRoom.current = room;
	const pauseRef = useRef<() => void>(() => {});
	const pause = () => {
		if (endingActive.current) {
			skipEnding.current?.();
			return;
		}
		if (!runtime.current || runtime.current.menu) return;
		runtime.current.menu = true;
		runtime.current.cancel();
		flight.current?.cancel();
		input.current?.cancel();
		audio.current?.pause(true);
		setMenu("pause");
		if (room.kind === "COMMUNITY") {
			setSaveStatus("PENDING");
			void socket
				.command("SET_COMMUNITY_PAUSED", { paused: true })
				.catch((cause) => setError(cause.message));
		}
	};
	pauseRef.current = pause;
	useEffect(() => {
		runtime.current?.updateRoom(room);
	}, [room]);
	useEffect(() => {
		if (room.kind !== "ROOM" || room.state !== "COUNTDOWN") {
			setCountdown(null);
			return;
		}
		const remaining = Number(room.currentPlay?.countdownRemainingMs || 0);
		if (remaining <= 0) {
			setCountdown(null);
			return;
		}
		const end = performance.now() + remaining;
		const update = () =>
			setCountdown(Math.max(1, Math.ceil((end - performance.now()) / 1000)));
		update();
		const timer = setInterval(update, 100);
		return () => clearInterval(timer);
	}, [room.kind, room.state, room.currentPlay]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Đổi membership/socket phải đóng chat dù callback không đổi.
	useEffect(() => {
		chat.closeChat();
	}, [room.roomId, socket, chat.closeChat]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Room ID đổi cần dựng session mới; closeChat là callback ổn định.
	useEffect(() => {
		let disposed = false,
			game: { destroy(removeCanvas: boolean): void } | undefined;
		const controller = new AbortController();
		let lastActivity = performance.now();
		const effects = new PlayerEffects(),
			adventureEffects = new AdventureEffects();
		let cueManifest: Awaited<ReturnType<typeof loadManifest>> | null = null;
		const controls = new InputController(
			() => {
				lastActivity = performance.now();
			},
			() => pauseRef.current(),
			() => {
				runtime.current?.cancel();
				flight.current?.cancel();
			},
			(now) => flight.current?.press(now),
		);
		input.current = controls;
		const afk = window.setInterval(() => {
			if (
				latestRoom.current.kind === "ROOM" &&
				runtime.current &&
				!runtime.current.menu &&
				performance.now() - lastActivity >= rules.afkMs
			)
				pauseRef.current();
		}, PRESENTATION.afkPollMs);
		const hidden = () => {
			if (document.hidden) pauseRef.current();
		};
		const blur = () => pauseRef.current();
		document.addEventListener("visibilitychange", hidden);
		window.addEventListener("blur", blur);
		const unsubscribe = socket.subscribe((type, payload) => {
			try {
				if (type === "GAME_SNAPSHOT") runtime.current?.receive(payload);
				if (type === "PLAYER_FINISHED") runtime.current?.finish(payload);
				if (
					type === "ADVENTURE_EVENTS" &&
					cueManifest &&
					runtime.current?.latest
				) {
					for (const cue of adventureEffects.receive(
						payload,
						latestRoom.current.roomId,
						runtime.current.latest.playId,
					)) {
						const key =
							cue.kind === "WORLD"
								? cue.type === "JINGLE"
									? "audio/music/event_music/ending_jingle"
									: cueManifest.walls.find((wall) => wall.id === cue.id)
											?.appearSound || "audio/illusion"
								: "audio/talking";
						audio.current?.play(key);
					}
				}
				if (type === "PLAYER_EFFECTS" && runtime.current?.latest) {
					const session = runtime.current;
					for (const effect of effects.receive(
						payload,
						latestRoom.current.roomId,
						socket.selfId || "",
						session.latest!.playId,
						session.game.physics.snapshot().screen,
					)) {
						audio.current?.effect(
							effect.effect,
							{
								snow: effect.terrain === "SNOW",
								ice: effect.terrain === "ICE",
							},
							effect.playerId === socket.selfId
								? PRESENTATION.effectVolume
								: PRESENTATION.peerEffectVolume,
						);
					}
				}
				if (type === "CONNECTION_CLOSED") {
					if (runtime.current) runtime.current.menu = true;
					controls.cancel();
					audio.current?.pause(true);
					setDisconnected(true);
					setMenu("pause");
					setError("Disconnected from the game server");
				}
				if (type === "RECONNECT_OK") {
					setDisconnected(false);
					setError("");
					if (runtime.current) runtime.current.menu = true;
					controls.cancel();
					setMenu("pause");
				}
				if (type === "COMMUNITY_RUN_STATE" || type === "SAVE_STATUS") {
					if (typeof payload.saveStatus === "string")
						setSaveStatus(payload.saveStatus);
				}
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : "Invalid game state");
				runtime.current?.cancel();
			}
		});
		void (async () => {
			const [renderer, manifest, mapData, config] = await Promise.all([
				import("../../game/presentation/createGame"),
				loadManifest(controller.signal),
				api<unknown>("/map"),
				api<{ features: { flyEnabled: boolean } }>("/game-config"),
			]);
			if (disposed) return;
			cueManifest = manifest;
			audio.current = new AudioBus(manifest, readOptions().sound, setError);
			const session = new OnlineRuntime(
				parseMap(mapData),
				socket,
				latestRoom.current,
				() => controls.read(),
				(state, snapshot) => {
					setElapsed(snapshot.elapsedTimeMs);
					setRemaining(snapshot.remainingTimeMs);
					setFlying(state.freeFlight);
					setPlayers(snapshot.players || []);
					audio.current?.setScreen(state.screen);
					if (snapshot.self.paused && !session.menu) {
						session.menu = true;
						controls.cancel();
						setMenu("pause");
						audio.current?.pause(true);
					}
				},
				config.features.flyEnabled,
				(message) => {
					setError(message);
					setMenu("pause");
					controls.cancel();
				},
			);
			runtime.current = session;
			if (socket.resumeRequired) {
				session.menu = true;
				controls.cancel();
				setMenu("pause");
				audio.current?.pause(true);
			}
			flight.current = new FlightToggle(
				config.features.flyEnabled,
				() => session.flying,
				(enabled) => {
					session.setFlight(enabled);
					setFlying(enabled);
				},
			);
			if (socket.lastFinish) session.finish(socket.lastFinish);
			if (socket.lastSnapshot) session.receive(socket.lastSnapshot);
			game = renderer.createGame(
				container.current!,
				manifest,
				session,
				() => {
					setReady(true);
					const current = latestRoom.current;
					if (
						current.kind === "ROOM" &&
						current.state === "COUNTDOWN" &&
						socket.playContext
					)
						void socket
							.command("GAME_READY", socket.playContext)
							.catch((cause) => setError(cause.message));
					if (document.hidden || !document.hasFocus()) pauseRef.current();
				},
				setError,
				{
					onEndingStart: (skip) => {
						skipEnding.current = skip;
						endingActive.current = true;
						controls.cancel();
						session.cancel();
						setMenu(null);
						chat.closeChat();
						setPictureReady(false);
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
					cause instanceof Error ? cause.message : "Unable to load online game",
				);
		});
		return () => {
			disposed = true;
			controller.abort();
			clearInterval(afk);
			unsubscribe();
			controls.dispose();
			runtime.current?.cancel();
			runtime.current = null;
			input.current = null;
			flight.current = null;
			game?.destroy(true);
			audio.current?.dispose();
			audio.current = null;
			document.removeEventListener("visibilitychange", hidden);
			window.removeEventListener("blur", blur);
		};
	}, [socket, room.roomId, chat.closeChat]);
	const command = async (
		type: string,
		payload: Record<string, unknown> = {},
	) => {
		if (pending) return;
		setPending(true);
		setError("");
		try {
			await socket.command(type, payload);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Action failed");
		} finally {
			setPending(false);
		}
	};
	const resume = async () => {
		if (room.kind === "COMMUNITY") {
			setPending(true);
			try {
				await socket.command("SET_COMMUNITY_PAUSED", { paused: false });
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : "Resume failed");
				return;
			} finally {
				setPending(false);
			}
		}
		socket.resumeRequired = false;
		if (runtime.current) runtime.current.menu = false;
		input.current?.resume();
		audio.current?.pause(false);
		setMenu(null);
	};
	const updateOptions = (key: keyof Options) => {
		const next = { ...options, [key]: !options[key] };
		setOptions(next);
		audio.current?.setEnabled(next.sound);
		try {
			saveOptions(next);
		} catch {
			setError("Options could not be saved on this device");
		}
	};
	return (
		<main className="play-page">
			<section
				className="game-viewport"
				ref={container}
				aria-label="Online Main Babe game"
			/>
			{!ready && !error && (
				<p className="game-message" role="status">
					Loading…
				</p>
			)}
			{!ready && error && (
				<div className="game-message">
					<p role="alert">{error}</p>
					<button
						type="button"
						disabled={pending}
						onClick={() => void command("LEAVE_ROOM")}
					>
						Leave
					</button>
				</div>
			)}
			{ready && room.kind === "ROOM" && room.state === "COUNTDOWN" && (
				<p className="game-message" role="status">
					{countdown ?? "Waiting for players…"}
				</p>
			)}
			{ready && !ending && (
				<div className="game-hud">
					<span>
						{
							<span className="timer" role="timer" aria-label="Play time">
								{duration(elapsed)}
							</span>
						}
						{remaining !== null && (
							<span className="timer" role="timer" aria-label="Time left">
								Time Left: {duration(Math.ceil(remaining / 1000) * 1000)}
							</span>
						)}
					</span>
					{room.kind === "ROOM" && (
						<output className="room-code" aria-label="Room ID">
							{room.roomId}
						</output>
					)}
					<span>
						<button
							type="button"
							aria-keyshortcuts="Enter"
							onClick={chat.openChat}
						>
							Chat
						</button>
						<button type="button" onClick={pause}>
							Menu
						</button>
					</span>
				</div>
			)}
			{ready && !ending && !menu && !chat.open && (
				<TouchControls input={input} flying={flying} />
			)}
			{ending && (
				<div className="ending-actions">
					{ending === "playing" ? (
						<button type="button" onClick={() => skipEnding.current?.()}>
							Skip
						</button>
					) : (
						<>
							{room.kind === "ROOM" ? (
								<button
									type="button"
									disabled={!pictureReady}
									onClick={onResults}
								>
									View Results
								</button>
							) : null}
							<button
								type="button"
								disabled={!pictureReady || pending || disconnected}
								onClick={() => {
									void command("LEAVE_ROOM");
								}}
							>
								Back to Menu
							</button>
						</>
					)}
				</div>
			)}
			{ready && !ending && <ChatOverlay chat={chat} socket={socket} />}
			{ready && !ending && (
				<aside className="in-game-panels">
					<PlayersPanel players={players} selfId={socket.selfId} />
					{room.kind === "COMMUNITY" && <InGameLeaderboard />}
				</aside>
			)}
			{menu && (
				<section className="game-overlay" aria-label="Game menu">
					<MenuPanel
						title={
							menu === "options"
								? "Options"
								: disconnected
									? "Disconnected"
									: room.kind === "ROOM"
										? "Game Menu"
										: "Paused"
						}
						onBack={menu === "options" ? () => setMenu("pause") : undefined}
					>
						{menu === "pause" ? (
							<>
								{disconnected ? (
									<>
										<button
											type="button"
											disabled={pending}
											onClick={() => {
												setPending(true);
												void socket
													.reconnect()
													.catch((cause) => setError(cause.message))
													.finally(() => setPending(false));
											}}
										>
											Reconnect
										</button>
										<button type="button" onClick={onHome}>
											Back to Menu
										</button>
									</>
								) : (
									<button
										type="button"
										disabled={pending}
										onClick={() => void resume()}
									>
										Resume
									</button>
								)}
								<button type="button" onClick={() => setMenu("options")}>
									Options
								</button>
								<button type="button" onClick={chat.openChat}>
									Open Chat
								</button>
								{room.kind === "ROOM" &&
									room.hostPlayerId === socket.selfId &&
									room.state === "PLAYING" && (
										<button
											type="button"
											disabled={pending || disconnected}
											onClick={() => void command("END_MATCH")}
										>
											End Match
										</button>
									)}
								<button
									type="button"
									disabled={pending || disconnected}
									onClick={() => void command("LEAVE_ROOM")}
								>
									{room.kind === "COMMUNITY" ? "Save & Exit" : "Leave Room"}
								</button>
								{room.kind === "COMMUNITY" && (
									<small role="status">
										{saveStatus === "SAVED"
											? "Saved"
											: saveStatus === "FAILED"
												? "Save failed"
												: "Saving…"}
									</small>
								)}
								<ControlsHelp />
							</>
						) : (
							<OptionsButtons
								options={options}
								onChange={updateOptions}
								onError={setError}
							/>
						)}
						{error && <p role="alert">{error}</p>}
					</MenuPanel>
				</section>
			)}
			{ready && error && !menu && (
				<p className="save-error" role="alert">
					{error}
				</p>
			)}
		</main>
	);
}
