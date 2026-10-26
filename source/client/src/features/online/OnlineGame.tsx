import {
	type CSSProperties,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { ControlsHelp } from "../../components/ControlsHelp";
import { MenuPanel } from "../../components/MenuPanel";
import { loadManifest } from "../../game/content/assets";
import { FlightToggle } from "../../game/input/FlightToggle";
import type { InputController } from "../../game/input/InputController";
import type { RoomItemsView } from "../../game/items";
import { AdventureEffects } from "../../game/netcode/AdventureEffects";
import {
	OnlineRuntime,
	type SpectatorView,
} from "../../game/netcode/OnlineRuntime";
import { PlayerEffects } from "../../game/netcode/PlayerEffects";
import { AudioBus } from "../../game/presentation/AudioBus";
import { PRESENTATION } from "../../game/presentation/config";
import { parseMap } from "../../game/simulation/map";
import { ROOM_MAPS } from "../../game/simulation/roomMaps";
import { PHYSICS } from "../../game/simulation/tuning";
import { ApiError, api } from "../../network/api";
import type {
	GameConfig,
	NetworkQuality,
	PlayerStanding,
} from "../../network/contracts";
import type { GameSocket, RoomState } from "../../network/GameSocket";
import { required } from "../../required";
import { Chat } from "../chat/Chat";
import { useChat } from "../chat/useChat";
import { InGameLeaderboard } from "../community/InGameLeaderboard";
import { duration } from "../records/format";
import type { Options } from "../settings/options";
import { SoundButton } from "../settings/SoundButton";
import { createGameControls } from "./gameControls";
import { LandscapeGate } from "./LandscapeGate";
import { NetworkStatusBadge } from "./NetworkStatusBadge";
import { PlayersPanel } from "./PlayersPanel";
import { TouchControls } from "./TouchControls";
import { TutorialGuide } from "./TutorialGuide";
import {
	isTutorialCompleted,
	nextTutorialStep,
	saveTutorialCompleted,
	type TutorialStep,
} from "./tutorial";
import { useGameWidth } from "./useGameWidth";

export function OnlineGame({
	socket,
	room,
	navigationError,
	options,
	onOptionsChange,
	accountId,
	firstGame,
	newCommunityRun,
	onHome,
	onResults,
}: {
	socket: GameSocket;
	room: RoomState;
	navigationError: string;
	options: Options;
	onOptionsChange: (key: keyof Options) => void;
	accountId?: string;
	firstGame: boolean;
	newCommunityRun: boolean;
	onHome: (message: string) => void;
	onResults: () => void;
}) {
	const layout = useRef<HTMLElement>(null);
	const gameWidth = useGameWidth(layout);
	const container = useRef<HTMLDivElement>(null),
		runtime = useRef<OnlineRuntime | null>(null),
		input = useRef<InputController | null>(null),
		audio = useRef<AudioBus | null>(null);
	const [countdown, setCountdown] = useState<number | null>(null);
	const [ready, setReady] = useState(false),
		[menu, setMenu] = useState(false);
	const flight = useRef<FlightToggle | null>(null);
	const [flying, setFlying] = useState(false);
	const sound = useRef(options.sound);
	sound.current = options.sound;
	const [error, setError] = useState(""),
		[pending, setPending] = useState(false),
		[elapsed, setElapsed] = useState(0);
	const [items, setItems] = useState<Pick<
		RoomItemsView,
		"held" | "bananaArmed" | "cooldownMs"
	> | null>(null);
	const [itemPending, setItemPending] = useState(false);
	const [jumpBoost, setJumpBoost] = useState(false);
	const placingItem = useRef(false);
	const [remaining, setRemaining] = useState<number | null>(null);
	const [players, setPlayers] = useState<PlayerStanding[]>([]);
	const [watching, setWatching] = useState<SpectatorView | null>(null);
	const viewedPlayer = useRef<string | null>(null);
	// ACK hủy xem có thể tới trước snapshot; tránh nhầm với việc mất mục tiêu.
	const returningToSelf = useRef(false);
	const [caption, setCaption] = useState<{
		id: string;
		name: string;
		delayMs: number;
	} | null>(null);
	const [disconnected, setDisconnected] = useState(false);
	const [networkQuality, setNetworkQuality] = useState<NetworkQuality>(() =>
		socket.getNetworkQuality(),
	);

	useEffect(() => {
		return socket.subscribeQuality(setNetworkQuality);
	}, [socket]);
	const [ending, setEnding] = useState<"playing" | "picture" | null>(null),
		[pictureReady, setPictureReady] = useState(false);
	const [tutorialStep, setTutorialStep] = useState<TutorialStep | null>(() =>
		room.kind === "COMMUNITY" && firstGame && !isTutorialCompleted(accountId)
			? "move"
			: null,
	);
	const tutorialRef = useRef<TutorialStep | null>(tutorialStep);
	tutorialRef.current = tutorialStep;
	const tutorialOrigin = useRef<{ x: number; jumps: number } | null>(null);
	const dismissTutorial = useCallback(() => {
		tutorialRef.current = null;
		setTutorialStep(null);
		saveTutorialCompleted(accountId);
	}, [accountId]);
	const endingActive = useRef(false),
		skipEnding = useRef<(() => void) | null>(null);
	const chat = useChat(
		socket,
		ready && !ending,
		() => {
			runtime.current?.cancel();
			flight.current?.cancel();
			input.current?.cancel();
		},
		() => {
			if (
				!runtime.current?.menu &&
				!runtime.current?.latest?.spectating &&
				!endingActive.current
			)
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
	const useItem = () => {
		const session = runtime.current,
			snapshot = session?.latest;
		if (
			!session ||
			room.kind !== "ROOM" ||
			room.state !== "PLAYING" ||
			disconnected ||
			flying ||
			!snapshot?.items?.held ||
			(snapshot.items.held === "BOOTS" && jumpBoost) ||
			session.menu ||
			snapshot.spectating ||
			snapshot.self.paused ||
			snapshot.self.status !== "ACTIVE" ||
			endingActive.current ||
			placingItem.current ||
			!socket.playContext ||
			chat.open
		)
			return;
		placingItem.current = true;
		setItemPending(true);
		setError("");
		void socket
			.command("USE_ITEM", socket.playContext)
			.catch((cause) =>
				setError(cause instanceof Error ? cause.message : "Could not use item"),
			)
			.finally(() => {
				placingItem.current = false;
				setItemPending(false);
			});
	};
	const useItemRef = useRef(useItem);
	useItemRef.current = useItem;
	useEffect(() => {
		const key = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.repeat ||
				event.code !== "KeyE" ||
				(event.target instanceof Element &&
					event.target.closest(
						'input,textarea,select,button,a,summary,[contenteditable="true"]',
					))
			)
				return;
			event.preventDefault();
			useItemRef.current();
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, []);
	const latestRoom = useRef(room);
	latestRoom.current = room;
	const removedNotice =
		room.kind === "COMMUNITY"
			? "Your room membership has ended. Continue will use the last server checkpoint."
			: "Your room membership has ended.";
	// Lệnh bị từ chối khi membership đã kết thúc ở server thì về trang chủ, không kẹt ở menu.
	const reportFailure = async (cause: unknown, fallback: string) => {
		const ended = await socket.command("GET_ROOM_STATE").then(
			(reply) => !reply.payload.roomId,
			() => false,
		);
		if (ended) onHome(removedNotice);
		else setError(cause instanceof Error ? cause.message : fallback);
	};
	const pauseRef = useRef<() => void>(() => {});
	const pauseRevision = useRef(0);
	const pause = () => {
		if (endingActive.current) {
			skipEnding.current?.();
			return;
		}
		pauseRevision.current++;
		if (!runtime.current || runtime.current.menu) return;
		runtime.current.menu = true;
		runtime.current.cancel();
		flight.current?.cancel();
		input.current?.cancel();
		audio.current?.pause(true);
		setMenu(true);
		if (room.kind === "COMMUNITY") {
			void socket
				.command("SET_COMMUNITY_PAUSED", { paused: true })
				.catch((cause) => reportFailure(cause, "Pause failed"));
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
		let initialCaptionTick: number | undefined;
		let rendererReady = false;
		const controller = new AbortController();
		const effects = new PlayerEffects(),
			adventureEffects = new AdventureEffects();
		let cueManifest: Awaited<ReturnType<typeof loadManifest>> | null = null;
		const bindings = createGameControls({
			pause: () => pauseRef.current(),
			cancel: () => {
				runtime.current?.cancel();
				flight.current?.cancel();
			},
			jump: (now) => flight.current?.press(now),
			pauseWhenIdle: () =>
				latestRoom.current.kind === "ROOM" &&
				!!runtime.current &&
				!runtime.current.menu &&
				!runtime.current.latest?.spectating,
		});
		const controls = bindings.input;
		input.current = controls;
		const unsubscribe = socket.subscribe((type, payload) => {
			try {
				if (type === "ERROR" && payload.code === "SAVE_FAILED")
					setError(String(payload.message));
				if (type === "GAME_SNAPSHOT") runtime.current?.receive(payload);
				if (type === "PLAYER_FINISHED") runtime.current?.finish(payload);
				if (
					type === "ADVENTURE_EVENTS" &&
					cueManifest &&
					runtime.current?.latest &&
					payload.sourcePlayerId === runtime.current.viewPlayerId
				) {
					for (const cue of adventureEffects.receive(
						payload,
						latestRoom.current.roomId,
						runtime.current.viewPlayId,
					)) {
						const key =
							cue.kind === "WORLD"
								? cue.type === "JINGLE"
									? "audio/music/event_music/ending_jingle"
									: cueManifest.walls.find((wall) => wall.id === cue.id)
											?.appearSound || "audio/illusion"
								: cue.type === "FLEE"
									? "audio/event_sfx/bird_fly"
									: "audio/talking";
						audio.current?.play(key);
					}
				}
				if (type === "PLAYER_EFFECTS" && runtime.current?.latest) {
					const session = runtime.current;
					for (const effect of effects.receive(
						payload,
						latestRoom.current.roomId,
						session.viewPlayerId,
						session.viewPlayId,
						session.frame().self.state.screen,
						session.latest?.spectating
							? undefined
							: (socket.selfId ?? undefined),
					)) {
						audio.current?.effect(
							effect.effect,
							{
								snow: effect.terrain === "SNOW",
								ice: effect.terrain === "ICE",
							},
							effect.playerId === session.viewPlayerId
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
					setMenu(true);
					setError(
						typeof payload.message === "string"
							? payload.message
							: "Disconnected from the game server",
					);
				}
				if (type === "RECONNECT_OK") {
					setDisconnected(false);
					setError("");
					if (runtime.current) runtime.current.menu = true;
					controls.cancel();
					setMenu(true);
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
				api<GameConfig>("/game-config"),
			]);
			if (disposed) return;
			cueManifest = manifest;
			audio.current = new AudioBus(manifest, sound.current, setError);
			const session = new OnlineRuntime(
				parseMap(mapData),
				socket,
				latestRoom.current,
				() => controls.read(),
				(state, snapshot) => {
					setElapsed(Math.floor(snapshot.elapsedTimeMs / 1000) * 1000);
					const item = snapshot.items;
					setItems((previous) => {
						if (!item) return null;
						const cooldownMs = Math.ceil(item.cooldownMs / 1000) * 1000;
						return previous?.held === item.held &&
							previous.bananaArmed === item.bananaArmed &&
							previous.cooldownMs === cooldownMs
							? previous
							: { held: item.held, bananaArmed: item.bananaArmed, cooldownMs };
					});
					setRemaining(
						snapshot.remainingTimeMs === null
							? null
							: Math.ceil(snapshot.remainingTimeMs / 1000) * 1000,
					);
					setFlying(state.freeFlight);
					setJumpBoost(state.jumpBoost === true);
					setPlayers((previous) => {
						const next = snapshot.players ?? [];
						return previous.length === next.length &&
							next.every((player, i) => {
								const old = required(previous[i]);
								return (
									old.playerId === player.playerId &&
									old.nickname === player.nickname &&
									old.colorSlot === player.colorSlot &&
									old.rank === player.rank &&
									Math.floor(old.currentProgress) ===
										Math.floor(player.currentProgress)
								);
							})
							? previous
							: next;
					});
					const view = snapshot.spectating;
					if (
						viewedPlayer.current &&
						!view &&
						!session.menu &&
						!returningToSelf.current
					) {
						session.menu = true;
						controls.cancel();
						setMenu(true);
						setError("The player is no longer available to watch.");
						audio.current?.pause(true);
					}
					if (!view) returningToSelf.current = false;
					viewedPlayer.current = view?.player.playerId ?? null;
					setWatching((previous) => {
						if (!view) return null;
						return previous?.player.playerId === view.player.playerId &&
							previous.player.nickname === view.player.nickname &&
							previous.paused === view.paused &&
							Math.floor(previous.elapsedTimeMs / 1000) ===
								Math.floor(view.elapsedTimeMs / 1000)
							? previous
							: view;
					});
					if (view) controls.cancel();
					const intro = (view?.world ?? snapshot.self.simulation.world)
						.mapIntro;
					if (intro) {
						const id = `${view?.playId ?? snapshot.playId}:${intro.level}:${intro.tick}`;
						const initialIntro =
							!view &&
							newCommunityRun &&
							latestRoom.current.kind === "COMMUNITY" &&
							intro.level === 1 &&
							intro.tick === 0;
						if (
							initialIntro &&
							rendererReady &&
							initialCaptionTick === undefined &&
							!socket.resumeRequired
						)
							initialCaptionTick = snapshot.self.simulation.physics.ticks;
						const introTick = initialIntro ? initialCaptionTick : intro.tick;
						const age =
							introTick === undefined
								? PRESENTATION.mapCaptionMs
								: (((view?.player.state.ticks ??
										snapshot.self.simulation.physics.ticks) -
										introTick) *
										1000) /
									PHYSICS.tickRate;
						setCaption((previous) =>
							age >= PRESENTATION.mapCaptionMs
								? null
								: previous?.id === id
									? previous
									: {
											id,
											name: ROOM_MAPS[intro.level - 1]?.name || "",
											delayMs: -age,
										},
						);
					}
					audio.current?.setScreen(view?.player.state.screen ?? state.screen);
					if (snapshot.self.paused && !session.menu && !view) {
						session.menu = true;
						controls.cancel();
						setMenu(true);
						audio.current?.pause(true);
					}
					if (
						tutorialRef.current &&
						!view &&
						!session.menu &&
						!snapshot.self.paused
					) {
						const physics = snapshot.self.simulation.physics;
						if (tutorialOrigin.current === null)
							tutorialOrigin.current = { x: physics.x, jumps: physics.jumps };
						const next = nextTutorialStep(
							tutorialRef.current,
							physics,
							tutorialOrigin.current,
						);
						if (next !== tutorialRef.current) {
							tutorialOrigin.current = { x: physics.x, jumps: physics.jumps };
							if (next === null) dismissTutorial();
							else {
								tutorialRef.current = next;
								setTutorialStep(next);
							}
						}
					}
				},
				config.features.flyEnabled,
				(message) => {
					setError(message);
					setMenu(true);
					controls.cancel();
				},
				(movement, state) => {
					for (const effect of movement) audio.current?.effect(effect, state);
				},
			);
			runtime.current = session;
			if (socket.resumeRequired) {
				session.menu = true;
				controls.cancel();
				setMenu(true);
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
				required(container.current),
				manifest,
				session,
				() => {
					rendererReady = true;
					setReady(true);
					const current = latestRoom.current;
					const snapshot = session.latest;
					const intro = snapshot?.self.simulation.world.mapIntro;
					if (
						newCommunityRun &&
						current.kind === "COMMUNITY" &&
						!socket.resumeRequired &&
						snapshot &&
						intro?.level === 1 &&
						intro.tick === 0
					) {
						// Caption đầu lượt đủ 3 giây sau khi tải màn chơi; Continue không phát lại.
						initialCaptionTick = snapshot.self.simulation.physics.ticks;
						setCaption({
							id: `${snapshot.playId}:1:0`,
							name: required(ROOM_MAPS[0]).name,
							delayMs: 0,
						});
					}
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
						setMenu(false);
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
			unsubscribe();
			bindings.dispose();
			runtime.current?.cancel();
			runtime.current = null;
			input.current = null;
			flight.current = null;
			game?.destroy(true);
			audio.current?.dispose();
			audio.current = null;
		};
	}, [socket, room.roomId, chat.closeChat, newCommunityRun]);
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
	const resume = async (ownGame = false) => {
		const revision = pauseRevision.current;
		if (
			room.kind === "COMMUNITY" &&
			(!runtime.current?.latest?.spectating || ownGame)
		) {
			setPending(true);
			try {
				await socket.command("SET_COMMUNITY_PAUSED", { paused: false });
			} catch (cause) {
				setMenu(true);
				await reportFailure(cause, "Resume failed");
				return;
			} finally {
				setPending(false);
			}
		}
		// Pause mới khi đang chờ ACK phải được ưu tiên hơn Resume cũ.
		if (revision !== pauseRevision.current) {
			if (room.kind === "COMMUNITY") {
				void socket
					.command("SET_COMMUNITY_PAUSED", { paused: true })
					.catch((cause) => reportFailure(cause, "Pause failed"));
			}
			return;
		}
		socket.resumeRequired = false;
		if (runtime.current) runtime.current.menu = false;
		if (ownGame || !runtime.current?.latest?.spectating)
			input.current?.resume();
		audio.current?.pause(false);
		setMenu(false);
	};
	const watch = async (playerId: string | null) => {
		const session = runtime.current;
		if (!session || pending || disconnected) return;
		setPending(true);
		setError("");
		session.menu = true;
		session.cancel();
		flight.current?.cancel();
		input.current?.cancel();
		chat.closeChat();
		returningToSelf.current = playerId === null;
		try {
			await socket.command("SET_SPECTATE", { playerId });
			if (playerId === null) await resume(true);
			else {
				session.menu = false;
				setMenu(false);
				audio.current?.pause(false);
			}
		} catch (cause) {
			returningToSelf.current = false;
			session.menu = true;
			setMenu(true);
			await reportFailure(cause, "Unable to watch player");
		} finally {
			setPending(false);
		}
	};
	useEffect(() => {
		audio.current?.setEnabled(options.sound);
	}, [options.sound]);
	const displayedError = navigationError || error;
	const captionPaused =
		!!menu || !!ending || disconnected || room.state === "COUNTDOWN";
	return (
		<main
			ref={layout}
			className="play-page"
			data-flying={flying}
			style={
				gameWidth
					? ({ "--game-width": `${gameWidth}px` } as CSSProperties)
					: undefined
			}
		>
			<div className="game-stage">
				<section className="game-viewport" aria-label="Online Main Babe game">
					{/* Phaser quản lý canvas; React giữ overlay ở phần tử anh em. */}
					<div className="game-surface" ref={container} />
					{ready && caption?.name && !ending && (
						<output
							key={caption.id}
							className="region-caption"
							aria-label="Current region"
							style={{
								visibility: captionPaused ? "hidden" : "visible",
								animationPlayState: captionPaused ? "paused" : "running",
								animationDuration: `${PRESENTATION.mapCaptionMs}ms`,
								animationDelay: `${caption.delayMs}ms`,
							}}
						>
							{caption.name}
						</output>
					)}
				</section>
				{!ready && !displayedError && (
					<p className="game-message" role="status">
						Loading…
					</p>
				)}
				{!ready && displayedError && (
					<div className="game-message">
						<p role="alert">{displayedError}</p>
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
				{ready &&
					!ending &&
					!menu &&
					!chat.open &&
					!watching &&
					room.kind === "COMMUNITY" &&
					tutorialStep && (
						<TutorialGuide step={tutorialStep} onDismiss={dismissTutorial} />
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
				{menu && (
					<section className="game-overlay" aria-label="Game menu">
						<MenuPanel
							title={
								disconnected
									? "Disconnected"
									: room.kind === "ROOM"
										? "Game Menu"
										: "Paused"
							}
						>
							{disconnected ? (
								<>
									<button
										type="button"
										disabled={pending}
										onClick={() => {
											setPending(true);
											void socket
												.reconnect()
												.catch((cause) => {
													if (
														cause instanceof ApiError &&
														["RECONNECT_EXPIRED", "ROOM_NOT_FOUND"].includes(
															cause.code,
														)
													)
														onHome(removedNotice);
													else setError(cause.message);
												})
												.finally(() => setPending(false));
										}}
									>
										Reconnect
									</button>
									<button
										type="button"
										onClick={() =>
											onHome(
												room.kind === "COMMUNITY"
													? "Disconnected. Latest save could not be confirmed. Continue will use the last server checkpoint."
													: "Disconnected. Your departure could not be confirmed by the server.",
											)
										}
									>
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
							<SoundButton
								options={options}
								onChange={onOptionsChange}
								onError={setError}
							/>
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
							<ControlsHelp />
							{displayedError && <p role="alert">{displayedError}</p>}
						</MenuPanel>
					</section>
				)}
				{ready && displayedError && !menu && (
					<p className="save-error" role="alert">
						{displayedError}
					</p>
				)}
			</div>
			{ready && !ending && (
				<div className="game-right">
					<aside className="game-sidebar" aria-label="Game panels">
						<div className="in-game-panels">
							<div className="game-panel-pane" data-panel="players">
								<PlayersPanel
									players={players}
									selfId={socket.selfId}
									watchingId={watching?.player.playerId}
									watchableIds={room.members
										.filter((member) => member.connected)
										.map((member) => member.playerId)}
									disabled={
										pending ||
										disconnected ||
										!!menu ||
										(room.kind === "ROOM" && room.state !== "PLAYING")
									}
									onWatch={(id) => void watch(id)}
								/>
							</div>
							{room.kind === "COMMUNITY" && (
								<div className="game-panel-pane" data-panel="leaderboard">
									<InGameLeaderboard />
								</div>
							)}
						</div>
					</aside>
					{!menu &&
						!chat.open &&
						!watching &&
						room.kind === "ROOM" &&
						room.settings?.itemCooldownMinutes != null && (
							<button
								className="item-control"
								type="button"
								aria-label="Use item"
								aria-keyshortcuts="E"
								aria-pressed={items?.bananaArmed ?? false}
								title={
									items?.held === "BANANA"
										? "Click to prepare a banana, then jump; click again to cancel"
										: items?.held === "BOOTS"
											? "Boost the height of your next jump"
											: "Throw at the highest other player"
								}
								disabled={
									!items?.held ||
									itemPending ||
									disconnected ||
									room.state !== "PLAYING" ||
									(items.held === "BOOTS" && jumpBoost) ||
									flying
								}
								onPointerDown={(event) => event.preventDefault()}
								onClick={useItem}
							>
								<span>E / Click · </span>
								{items?.held === "BANANA"
									? items.bananaArmed
										? "Banana · Jump to drop"
										: "Banana · Prepare"
									: items?.held === "ROCK"
										? "Rock · Throw"
										: items?.held === "BOOTS"
											? "Boots · Use"
											: `Item ${duration(Math.ceil((items?.cooldownMs ?? 0) / 1000) * 1000)}`}
								{jumpBoost && (
									<>
										<br />
										<span>Next jump ×2</span>
									</>
								)}
							</button>
						)}
				</div>
			)}
			{ready && !ending && (
				<aside className="game-left" aria-label="Game controls and chat">
					<div className="game-hud">
						<span>
							<span className="timer" role="timer" aria-label="Play time">
								{duration(watching?.elapsedTimeMs ?? elapsed)}
							</span>
							{remaining !== null && (
								<span className="timer" role="timer" aria-label="Time left">
									Time Left: {duration(Math.ceil(remaining / 1000) * 1000)}
								</span>
							)}
						</span>
						<span>
							<NetworkStatusBadge quality={networkQuality} />
							<button type="button" onClick={pause}>
								Menu (Esc)
							</button>
						</span>
					</div>
					{watching && !menu && (
						<div className="spectator-bar" role="status">
							<span
								className="spectator-label"
								title={`Watching ${watching.player.nickname}`}
							>
								Watching {watching.player.nickname}
								{watching.paused ? " (Paused)" : ""}
							</span>
							<button
								type="button"
								disabled={pending || disconnected}
								onClick={() => void watch(null)}
							>
								Back to My Game
							</button>
						</div>
					)}
					<section className="game-chat" aria-label="Game chat">
						<Chat chat={chat} socket={socket} dismissible />
					</section>
				</aside>
			)}
			{ready && !ending && !menu && !chat.open && !watching && (
				<TouchControls input={input} flying={flying} />
			)}
			{ready && !ending && (
				<LandscapeGate onPortrait={() => pauseRef.current()} />
			)}
		</main>
	);
}
