import {
	Check,
	Crown,
	Eye,
	LogOut,
	Map as MapIcon,
	Play,
	Settings2,
	Timer,
	Users,
	X,
} from "lucide-react";
import ROOM_MAPS from "../../../../common/room-maps.json";
import rules from "../../../../common/rules.json";
import type { RoomState } from "../../network/GameSocket";
import { ItemSettings } from "./ItemSettings";
import { RoomCode } from "./RoomCode";

export function Lobby({
	room,
	selfId,
	pending,
	command,
}: {
	room: RoomState;
	selfId: string | null;
	pending: boolean;
	command: (type: string, payload?: Record<string, unknown>) => void;
}) {
	const members = room.members.filter(
		(member) => member.nextMatchJoined === true,
	);
	const self = members.find((member) => member.playerId === selfId);
	const host = !!self && room.hostPlayerId === selfId;
	const confirmed = self?.nextMatchConfirmed === true;
	return (
		<div className="lobby-layout">
			<section className="lobby-roster" aria-label="Room players">
				<header className="lobby-header">
					<h3>
						<Users className="tone-blue" aria-hidden="true" />
						Lobby
					</h3>
					<RoomCode roomId={room.roomId} />
				</header>
				<p className="muted">
					Players ({members.length}/{rules.roomCapacity})
				</p>
				{room.state === "COUNTDOWN" && <p role="status">Starting…</p>}
				<ul className="players">
					{members.map((member) => (
						<li key={member.playerId}>
							<span>{member.nickname}</span>
							<span className="player-badges">
								{member.playerId === room.hostPlayerId && (
									<span className="tone-amber">
										<Crown aria-hidden="true" />
										Host
									</span>
								)}
								{!member.connected && <span className="muted">Offline</span>}
								{member.nextMatchConfirmed && (
									<span className="tone-green">
										<Check aria-hidden="true" />
										Confirmed
									</span>
								)}
								{host &&
									room.state === "WAITING" &&
									member.playerId !== selfId && (
										<button
											type="button"
											aria-label={`Kick ${member.nickname}`}
											disabled={pending}
											onClick={() =>
												command("KICK_PLAYER", { playerId: member.playerId })
											}
										>
											Kick
										</button>
									)}
							</span>
						</li>
					))}
				</ul>
				<div className="lobby-actions">
					{host && room.state === "WAITING" && (
						<button
							type="button"
							className="button-primary start-button"
							aria-label="Start"
							disabled={
								pending ||
								!confirmed ||
								members.filter(
									(member) =>
										member.connected && member.nextMatchConfirmed === true,
								).length < rules.minimumRoomPlayers
							}
							onClick={() => command("START_GAME")}
						>
							<Play aria-hidden="true" />
							Start
						</button>
					)}
					{self && room.state === "WAITING" && (
						<button
							type="button"
							aria-label={confirmed ? "Cancel" : "Confirm"}
							title={confirmed ? "Cancel" : "Confirm"}
							disabled={pending}
							onClick={() =>
								command("SET_ROOM_CONFIRMED", { confirmed: !confirmed })
							}
						>
							{confirmed ? (
								<X aria-hidden="true" />
							) : (
								<Check aria-hidden="true" />
							)}
							<span className="confirm-label">
								{confirmed ? "Cancel" : "Confirm"}
							</span>
						</button>
					)}
					<button
						type="button"
						className="button-danger"
						disabled={pending}
						onClick={() => command("LEAVE_ROOM")}
					>
						<LogOut aria-hidden="true" />
						Leave
					</button>
				</div>
			</section>
			{room.settings && (
				<section className="lobby-settings" aria-label="Room settings">
					<h3>
						<Settings2 aria-hidden="true" />
						Room Settings
					</h3>
					<label className="mode-setting">
						<span className="setting-label">
							<MapIcon className="tone-cyan" aria-hidden="true" />
							Map
						</span>
						<select
							aria-label="Map"
							value={room.settings.mapId}
							disabled={!host || room.state !== "WAITING" || pending}
							onChange={(event) =>
								command("UPDATE_ROOM_SETTINGS", {
									mapId: Number(event.target.value),
								})
							}
						>
							{ROOM_MAPS.map((map) => (
								<option key={map.level} value={map.level}>
									{map.level} · {map.name}
								</option>
							))}
						</select>
					</label>
					<label className="mode-setting">
						<span className="setting-label">
							<Eye aria-hidden="true" />
							Visibility
						</span>
						<select
							aria-label="Visibility"
							value={room.visibility}
							disabled={!host || room.state !== "WAITING" || pending}
							onChange={(event) =>
								command("UPDATE_ROOM_SETTINGS", {
									visibility: event.target.value,
								})
							}
						>
							<option value="PRIVATE">Private</option>
							<option value="PUBLIC">Public</option>
						</select>
					</label>
					<label className="mode-setting">
						<span className="setting-label">
							<Users className="tone-blue" aria-hidden="true" />
							Mode
						</span>
						<select
							aria-label="Mode"
							value={room.settings.mode}
							disabled={!host || room.state !== "WAITING" || pending}
							onChange={(event) =>
								command("UPDATE_ROOM_SETTINGS", {
									mode: event.target.value,
								})
							}
						>
							<option value="RACE">RACE – Default</option>
							<option value="EASY">EASY – Respawn at Last Position</option>
							<option value="HARDCORE">HARDCORE – Restart on Death</option>
							<option value="NO_WALK">NO WALK – Jump Only</option>
						</select>
					</label>
					<label className="mode-setting">
						<span className="setting-label">
							<Timer className="tone-amber" aria-hidden="true" />
							Time Limit
						</span>
						<select
							aria-label="Time Limit"
							value={room.settings.timeLimitMinutes ?? "UNLIMITED"}
							disabled={!host || room.state !== "WAITING" || pending}
							onChange={(event) =>
								command("UPDATE_ROOM_SETTINGS", {
									timeLimitMinutes:
										event.target.value === "UNLIMITED"
											? null
											: Number(event.target.value),
								})
							}
						>
							<option value="UNLIMITED">Unlimited</option>
							{Array.from(
								{
									length:
										rules.timeLimitMinutesMax - rules.timeLimitMinutesMin + 1,
								},
								(_, i) => i + rules.timeLimitMinutesMin,
							).map((minutes) => (
								<option key={minutes} value={minutes}>
									{minutes} min
								</option>
							))}
						</select>
					</label>
					<ItemSettings
						value={room.settings}
						disabled={!host || room.state !== "WAITING" || pending}
						onChange={(patch) => command("UPDATE_ROOM_SETTINGS", patch)}
					/>
				</section>
			)}
		</div>
	);
}
