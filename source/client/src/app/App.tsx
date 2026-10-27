import {
	ChevronRight,
	FilePlus2,
	History,
	LockKeyhole,
	LogIn,
	LogOut,
	Play,
	Search,
	UserRound,
	UserRoundPlus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MenuPanel } from "../components/MenuPanel";
import { AuthForm } from "../features/account/AuthForm";
import { ChangePassword } from "../features/account/ChangePassword";
import { LobbyChat } from "../features/chat/Chat";
import { OnlineGame } from "../features/online/OnlineGame";
import { HistoryDetail } from "../features/records/HistoryDetail";
import { HistoryList } from "../features/records/HistoryList";
import { StatisticsPanel } from "../features/records/StatisticsPanel";
import { roomFinishScreen } from "../features/rooms/ending";
import { Lobby } from "../features/rooms/Lobby";
import { PublicRooms } from "../features/rooms/PublicRooms";
import { Results } from "../features/rooms/Results";
import { reconnectLobby } from "../features/rooms/reconnectLobby";
import { readOptions, saveOptions } from "../features/settings/options";
import { ApiError, api, backendOrigin, clearCsrf } from "../network/api";
import type { HistoryItem, Identity, Statistics } from "../network/contracts";
import {
	GameSocket,
	type MatchResult,
	type RoomState,
} from "../network/GameSocket";
import { loadReconnect } from "../network/reconnect";
import { required } from "../required";
import { LoadErrorNotice, usePreloadError } from "./LoadErrorNotice";

type Screen =
	| "home"
	| "online"
	| "sign-in"
	| "account"
	| "history"
	| "detail"
	| "password"
	| "public-rooms"
	| "lobby"
	| "results";
const initialIdentity: Identity = {
	authenticated: false,
	account: null,
};
const routes: Partial<Record<Screen, string>> = {
	home: "/",
	history: "/history",
	account: "/account",
	"sign-in": "/sign-in",
};
const REMOVED_FROM_ROOM =
	"Your room membership has ended. For Community, use Continue to load the last server checkpoint.";
function locationScreen(): Screen {
	return typeof location === "undefined"
		? "home"
		: (Object.entries(routes).find(
				([, path]) => path === location.pathname,
			)?.[0] as Screen | undefined) || "home";
}
export function App() {
	const loadError = usePreloadError();
	const [screen, setScreenState] = useState<Screen>(locationScreen);
	const [identity, setIdentityState] = useState<Identity>(initialIdentity);
	const identityRevision = useRef(0);
	const setIdentity = useCallback((value: Identity) => {
		identityRevision.current++;
		setIdentityState(value);
	}, []);
	const [homeData, setHomeData] = useState<{
		accountId: string;
		run: { id: string } | null;
		statistics: Statistics;
	} | null>(null);
	const [homeLoading, setHomeLoading] = useState(false);
	const [homeRevision, setHomeRevision] = useState(0);
	const [detail, setDetail] = useState<{
		accountId: string;
		item: HistoryItem;
	} | null>(null);
	const [room, setRoom] = useState<RoomState | null>(null);
	const [newCommunityRun, setNewCommunityRun] = useState(false);
	const [result, setResult] = useState<MatchResult | null>(null);
	const resultRef = useRef<MatchResult | null>(null);
	const viewedEnding = useRef<string | null>(null);
	const [options, setOptions] = useState(readOptions);
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const socket = useRef<GameSocket | null>(null);
	const leaveRequested = useRef(false);
	const exitScreen = useRef<Screen | null>(null);
	const [navigationError, setNavigationError] = useState("");
	const [connectionNotice, setConnectionNotice] = useState("");
	const [disconnected, setDisconnected] = useState(false);
	const [reconnecting, setReconnecting] = useState(false);
	const reconnectTask = useRef<Promise<void> | null>(null);
	const reconnectAction = useRef<() => Promise<void>>(async () => {});
	const leaveOnline = useCallback(() => {
		const connection = socket.current;
		if (!connection?.selfId) return Promise.resolve();
		leaveRequested.current = true;
		return connection.command("LEAVE_ROOM").then(() => {});
	}, []);
	const setScreen = useCallback(
		(next: Screen) => {
			const connection = socket.current;
			if (
				connection?.selfId &&
				!["online", "lobby", "results"].includes(next)
			) {
				exitScreen.current = next;
				setNavigationError("");
				void leaveOnline().catch((cause) => {
					if (socket.current !== connection) return;
					exitScreen.current = null;
					setNavigationError(
						cause instanceof Error
							? cause.message
							: "Unable to leave online game",
					);
				});
				return;
			}
			if (routes[next] && location.pathname !== routes[next])
				window.history.pushState(null, "", routes[next]);
			setScreenState(next);
		},
		[leaveOnline],
	);
	const connect = useRef<(() => Promise<GameSocket>) | null>(null);
	const accountId = identity.account?.id;
	const reconnectProfile = accountId
		? `${backendOrigin()}:account:${accountId}`
		: "";
	const home = homeData?.accountId === accountId ? homeData : null;
	const back = () => {
		const next =
			screen === "password" || (screen === "history" && identity.account)
				? "account"
				: screen === "detail"
					? "history"
					: "home";
		if (routes[next]) window.history.replaceState(null, "", routes[next]);
		setError("");
		setScreen(next);
	};
	const execute = async (action: () => Promise<void>) => {
		if (pending) return;
		setPending(true);
		setError("");
		try {
			await action();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Unable to complete this action",
			);
		} finally {
			setPending(false);
		}
	};

	useEffect(() => {
		let disposed = false;
		const expectedIdentityRevision = identityRevision.current;
		const pop = () => {
			setScreen(locationScreen());
		};
		const pageHide = () => {
			// Gửi ngay khi page rời đi; không đóng socket trước xác nhận Leave.
			void leaveOnline().catch(() => {});
		};
		window.addEventListener("popstate", pop);
		window.addEventListener("pagehide", pageHide);
		void api<Identity>("/auth/me")
			.then((value) => {
				if (typeof value.authenticated !== "boolean") return;
				if (!disposed && identityRevision.current === expectedIdentityRevision)
					setIdentity(value);
			})
			.catch(() => {});
		return () => {
			disposed = true;
			window.removeEventListener("popstate", pop);
			window.removeEventListener("pagehide", pageHide);
			const connection = socket.current;
			if (connection?.selfId)
				void leaveOnline()
					.catch(() => {})
					.finally(() => connection.close());
			else connection?.close();
		};
	}, [setIdentity, leaveOnline, setScreen]);
	useEffect(() => {
		if (!identity.authenticated) return;
		let cancelled = false;
		void loadReconnect(reconnectProfile)
			.then(async (context) => {
				if (!context || cancelled) return;
				await connect.current?.();
			})
			.catch((cause) => {
				if (!cancelled)
					setError(cause instanceof Error ? cause.message : "Reconnect failed");
			});
		return () => {
			cancelled = true;
		};
	}, [reconnectProfile, identity.authenticated]);
	useEffect(() => {
		if (
			!disconnected ||
			screen !== "lobby" ||
			room?.kind !== "ROOM" ||
			room.state !== "WAITING"
		)
			return;
		return reconnectLobby(() =>
			leaveRequested.current ? Promise.resolve() : reconnectAction.current(),
		);
	}, [disconnected, screen, room?.kind, room?.state]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Revision cho phép thử tải lại sau lỗi hoặc save thay đổi ở tab khác.
	useEffect(() => {
		if (screen !== "home") return;
		if (!accountId) {
			setHomeLoading(false);
			setHomeData(null);
			return;
		}
		let disposed = false;
		setHomeLoading(true);
		setHomeData(null);
		void Promise.all([
			api<{ total: Statistics }>("/profile/me"),
			api<{ run: { id: string } | null }>("/community/current"),
		])
			.then(([profile, current]) => {
				if (!disposed)
					setHomeData({
						accountId,
						run: current.run,
						statistics: profile.total,
					});
			})
			.catch((cause) => {
				if (!disposed)
					setError(
						cause instanceof Error ? cause.message : "Save could not be loaded",
					);
			})
			.finally(() => {
				if (!disposed) setHomeLoading(false);
			});
		return () => {
			disposed = true;
		};
	}, [screen, accountId, homeRevision]);

	const connectedSocket = async () => {
		if (!identity.authenticated || !identity.account)
			throw new Error("Sign in to play online");
		if (!socket.current) {
			const connection = new GameSocket(
				(type, payload, replied) => {
					if (socket.current !== connection) return;
					if (type === "ROOM_JOINED") leaveRequested.current = false;
					if (type === "ROOM_STATE") {
						const next = payload as unknown as RoomState;
						if (!next.roomId) {
							setRoom(null);
							setScreen("home");
							return;
						}
						setRoom(next);
						setDisconnected(false);
						if (next.kind === "COMMUNITY") {
							setScreen("online");
							return;
						}
						if (next.result && typeof next.result === "object") {
							resultRef.current = next.result as MatchResult;
							setResult(next.result as MatchResult);
						}
						if (next.state === "PLAYING" || next.state === "COUNTDOWN") {
							setScreen("online");
							return;
						}
						const self = next.members?.find(
							(member) => member.playerId === socket.current?.selfId,
						);
						setScreen(
							resultRef.current &&
								self?.nextMatchJoined !== true &&
								(next.state === "WAITING" || next.state === "FINISHED")
								? roomFinishScreen(
										resultRef.current,
										socket.current?.selfId || null,
										viewedEnding.current,
									)
								: "lobby",
						);
					} else if (type === "GAME_FINISHED") {
						const finished = payload as unknown as MatchResult;
						resultRef.current = finished;
						setResult(finished);
						setScreen(
							roomFinishScreen(
								finished,
								socket.current?.selfId || null,
								viewedEnding.current,
							),
						);
					} else if (type === "GAME_STARTED") {
						resultRef.current = null;
						setResult(null);
					} else if (
						type === "SAVE_STATUS" &&
						resultRef.current !== null &&
						resultRef.current.playId === payload.playId &&
						["PENDING", "SAVED", "FAILED"].includes(String(payload.saveStatus))
					) {
						const updated = {
							...resultRef.current,
							saveStatus: payload.saveStatus as MatchResult["saveStatus"],
						};
						resultRef.current = updated;
						setResult(updated);
						setScreenState((current) =>
							current === "lobby"
								? current
								: roomFinishScreen(
										updated,
										socket.current?.selfId || null,
										viewedEnding.current,
									),
						);
					} else if (type === "ROOM_LEFT") {
						const next = exitScreen.current;
						exitScreen.current = null;
						setNavigationError("");
						setDisconnected(false);
						setRoom(null);
						setResult(null);
						resultRef.current = null;
						socket.current?.close();
						socket.current = null;
						if (next) setScreen(next);
						else if (replied) back();
						else {
							// Server tự đưa người chơi ra: về trang chủ và báo lý do.
							setError("");
							setConnectionNotice(
								payload.reason === "KICKED"
									? "You were kicked from the room by the host."
									: REMOVED_FROM_ROOM,
							);
							setScreen("home");
						}
					} else if (type === "ERROR") setError(String(payload.message));
				},
				() => {
					if (socket.current === connection) {
						setDisconnected(true);
						setError("Disconnected from the game server");
					}
				},
			);
			socket.current = connection;
		}
		await socket.current.restore(reconnectProfile);
		return socket.current;
	};
	connect.current = connectedSocket;
	reconnectAction.current = () => {
		if (reconnectTask.current) return reconnectTask.current;
		const connection = socket.current;
		if (!connection) return Promise.resolve();
		setReconnecting(true);
		setError("");
		const task = connection
			.reconnect()
			.catch((cause) => {
				if (socket.current !== connection) return;
				if (
					cause instanceof ApiError &&
					["RECONNECT_EXPIRED", "ROOM_NOT_FOUND"].includes(cause.code)
				) {
					connection.close();
					socket.current = null;
					setDisconnected(false);
					setRoom(null);
					setResult(null);
					resultRef.current = null;
					setError("");
					setConnectionNotice(REMOVED_FROM_ROOM);
					setScreen("home");
				} else
					setError(cause instanceof Error ? cause.message : "Reconnect failed");
				throw cause;
			})
			.finally(() => {
				if (reconnectTask.current === task) {
					reconnectTask.current = null;
					setReconnecting(false);
				}
			});
		reconnectTask.current = task;
		return task;
	};
	const command = (type: string, payload: Record<string, unknown> = {}) => {
		if (type === "LEAVE_ROOM") leaveRequested.current = true;
		void execute(async () => {
			const connection = await connectedSocket();
			await connection.command(type, payload);
		});
	};
	const enterCommunity = (newRun: boolean) => {
		setConnectionNotice("");
		if (!identity.account) {
			setScreen("sign-in");
			return;
		}
		if (pending || homeLoading || !home || (!newRun && !home.run)) return;
		if (newRun && home.run && !window.confirm("Replace your unfinished game?"))
			return;
		setNewCommunityRun(newRun);
		void execute(async () => {
			try {
				const connection = await connectedSocket();
				await connection.command("JOIN_COMMUNITY", {
					newRun,
					expectedRunId: home.run?.id ?? null,
				});
			} catch (cause) {
				setHomeRevision((value) => value + 1);
				throw cause;
			}
		});
	};
	const updateOptions = (key: keyof typeof options) => {
		const next = { ...options, [key]: !options[key] };
		setOptions(next);
		saveOptions(next);
	};

	const displayedError = navigationError || error;
	if (screen === "online" && room && socket.current)
		return (
			<>
				<LoadErrorNotice failed={loadError} canReload={false} />
				<OnlineGame
					room={room}
					socket={socket.current}
					navigationError={navigationError}
					options={options}
					onOptionsChange={updateOptions}
					newCommunityRun={newCommunityRun}
					accountId={accountId}
					firstGame={
						!!home &&
						!home.run &&
						home.statistics.totalPlayTimeMs === 0 &&
						home.statistics.matchesPlayed === 0
					}
					onResults={() => {
						viewedEnding.current = resultRef.current?.playId || null;
						setScreen("results");
					}}
					onHome={(message) => {
						setNavigationError("");
						socket.current?.close();
						socket.current = null;
						setRoom(null);
						setResult(null);
						resultRef.current = null;
						exitScreen.current = null;
						setError("");
						setConnectionNotice(message);
						setHomeRevision((value) => value + 1);
						setScreen("home");
						clearCsrf();
						const expectedIdentityRevision = identityRevision.current;
						void api<Identity>("/auth/me")
							.then((value) => {
								if (identityRevision.current === expectedIdentityRevision)
									setIdentity(value);
							})
							.catch((cause) => {
								if (identityRevision.current !== expectedIdentityRevision)
									return;
								if (
									cause instanceof ApiError &&
									["SESSION_EXPIRED", "UNAUTHENTICATED"].includes(cause.code)
								)
									setIdentity(initialIdentity);
								else
									setError(
										cause instanceof Error
											? cause.message
											: "Identity could not be refreshed",
									);
							});
					}}
				/>
			</>
		);
	return (
		<main className={`home screen-${screen}`}>
			<LoadErrorNotice
				failed={loadError}
				canReload={
					screen === "home" && !room && !pending && !socket.current?.selfId
				}
			/>
			<header className="brand">
				<h1>
					<img src="/ui/logo.png" alt="JumpKing" width="1903" height="815" />
				</h1>
			</header>
			<div
				className={
					screen === "home" && home
						? "home-layout"
						: screen === "lobby"
							? "lobby-panel"
							: "single-panel"
				}
			>
				<MenuPanel
					label={screen === "lobby" ? "Lobby" : undefined}
					showBack={screen !== "history"}
					title={
						screen === "home"
							? undefined
							: (
									{
										"sign-in": "Sign In / Log In",
										password: "Change Password",
										account: "Account",
										history: "History",
										detail: "Game Details",

										"public-rooms": "Public Rooms",
										results: "Results",
									} as Partial<Record<Screen, string>>
								)[screen]
					}
					onBack={
						screen === "home" || screen === "lobby" || screen === "results"
							? undefined
							: back
					}
				>
					{screen === "home" && (
						<>
							{home?.run && (
								<button
									type="button"
									className="button-primary home-action"
									onClick={() => enterCommunity(false)}
									disabled={pending || (!!accountId && (homeLoading || !home))}
								>
									<Play aria-hidden="true" />
									Continue
								</button>
							)}
							<button
								type="button"
								className="home-action"
								onClick={() => enterCommunity(true)}
								disabled={pending || (!!accountId && (homeLoading || !home))}
							>
								<FilePlus2 className="tone-purple" aria-hidden="true" />
								New Game
							</button>
							<button
								type="button"
								className="home-action"
								disabled={pending}
								onClick={() => {
									if (!identity.account) setScreen("sign-in");
									else command("CREATE_ROOM");
								}}
							>
								<UserRoundPlus className="tone-amber" aria-hidden="true" />
								Create Room
							</button>
							<button
								type="button"
								className="home-action"
								onClick={() =>
									setScreen(identity.account ? "public-rooms" : "sign-in")
								}
							>
								<Search className="tone-cyan" aria-hidden="true" />
								Join Public Room
							</button>
							<form
								className="room-join-form"
								onSubmit={(event) => {
									event.preventDefault();
									if (!identity.account) {
										setScreen("sign-in");
										return;
									}
									const roomId = String(
										new FormData(event.currentTarget).get("roomId") || "",
									).trim();
									command("JOIN_ROOM", { roomId });
								}}
							>
								<input
									name="roomId"
									aria-label="Room ID"
									placeholder="Enter Room ID"
									required
									minLength={6}
									maxLength={6}
									inputMode="numeric"
									autoComplete="off"
									pattern="[0-9]{6}"
								/>
								<button
									type="submit"
									className="button-primary"
									disabled={pending}
								>
									Join
								</button>
							</form>
							<div className="account-actions">
								{identity.account ? (
									<button type="button" onClick={() => setScreen("account")}>
										<UserRound aria-hidden="true" />
										<span>{identity.account.username}</span>
										<ChevronRight
											className="trailing-icon"
											aria-hidden="true"
										/>
									</button>
								) : (
									<button type="button" onClick={() => setScreen("sign-in")}>
										<LogIn aria-hidden="true" />
										Sign In / Log In
									</button>
								)}
							</div>
						</>
					)}
					{screen === "sign-in" && (
						<AuthForm
							key={screen}
							onSuccess={(value) => {
								setIdentity(value);
								back();
							}}
						/>
					)}
					{screen === "account" && identity.account && (
						<>
							<div className="account-info">
								<UserRound aria-hidden="true" />
								<dl>
									<dt>Username</dt>
									<dd>{identity.account.username}</dd>
								</dl>
							</div>
							<button type="button" onClick={() => setScreen("history")}>
								<History className="tone-cyan" aria-hidden="true" />
								History
								<ChevronRight className="trailing-icon" aria-hidden="true" />
							</button>
							{identity.account.hasPassword && (
								<button type="button" onClick={() => setScreen("password")}>
									<LockKeyhole className="tone-amber" aria-hidden="true" />
									Change Password
									<ChevronRight className="trailing-icon" aria-hidden="true" />
								</button>
							)}
							<button
								type="button"
								className="button-danger"
								disabled={pending}
								onClick={() => {
									void execute(async () => {
										await api("/auth/logout", "POST");
										socket.current?.close();
										socket.current = null;
										clearCsrf();
										setIdentity(initialIdentity);
										back();
									});
								}}
							>
								<LogOut aria-hidden="true" />
								Sign Out
							</button>
						</>
					)}
					{screen === "password" && identity.account?.hasPassword && (
						<ChangePassword
							onChanged={() => {
								socket.current?.close();
								socket.current = null;
								setIdentity(initialIdentity);
								setScreen("sign-in");
								setError("Password changed. Sign in again.");
							}}
						/>
					)}
					{screen === "history" &&
						(identity.account ? (
							<HistoryList
								key={accountId}
								onBack={back}
								onSelect={(item) => {
									setDetail({ accountId: required(identity.account).id, item });
									setScreen("detail");
								}}
							/>
						) : (
							<button type="button" onClick={() => setScreen("sign-in")}>
								Sign In / Log In
							</button>
						))}
					{screen === "detail" && detail?.accountId === accountId && detail && (
						<HistoryDetail
							key={`${detail.item.kind}:${detail.item.id}`}
							item={detail.item}
						/>
					)}
					{screen === "public-rooms" && identity.authenticated && (
						<PublicRooms
							pending={pending}
							onJoin={(roomId) => command("JOIN_ROOM", { roomId })}
						/>
					)}
					{screen === "lobby" && room && (
						<Lobby
							room={room}
							selfId={socket.current?.selfId || null}
							pending={pending || disconnected || reconnecting}
							command={command}
						/>
					)}
					{disconnected && room && (
						<button
							type="button"
							disabled={pending || reconnecting}
							onClick={() => {
								leaveRequested.current = false;
								void reconnectAction.current().catch(() => {});
							}}
						>
							Reconnect
						</button>
					)}
					{screen === "results" && result && (
						<Results
							result={result}
							room={room}
							selfId={socket.current?.selfId || null}
							pending={pending}
							onAgain={() => command("PLAY_AGAIN", { matchId: result.playId })}
							onLeave={() => command("LEAVE_ROOM")}
						/>
					)}

					{screen === "home" && connectionNotice && (
						<p role="status">{connectionNotice}</p>
					)}
					{pending && <p role="status">Please wait…</p>}
					{displayedError && (
						<p className="error" role="alert">
							{displayedError}
						</p>
					)}
					{screen === "home" && accountId && !home && !homeLoading && (
						<button
							type="button"
							onClick={() => {
								setError("");
								setHomeRevision((value) => value + 1);
							}}
						>
							Retry
						</button>
					)}
					{screen === "home" && accountId && homeLoading && (
						<p role="status">Loading…</p>
					)}
				</MenuPanel>
				{screen === "home" && home && (
					<StatisticsPanel statistics={home.statistics} />
				)}
			</div>
			{screen === "lobby" && room && socket.current && (
				<LobbyChat socket={socket.current} />
			)}
		</main>
	);
}
