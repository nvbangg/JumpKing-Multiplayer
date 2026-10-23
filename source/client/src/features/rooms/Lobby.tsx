import { useEffect, useState } from "react";
import rules from "../../../../common/rules.json";
import { ROOM_MAPS } from "../../game/simulation/roomMaps";
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
	const host = room.hostPlayerId === selfId;
	const limit =
		room.settings?.timeLimitMinutes ?? rules.timeLimitDefaultMinutes;
	const [minutes, setMinutes] = useState(String(limit)),
		[minutesError, setMinutesError] = useState("");
	useEffect(() => {
		setMinutes(String(limit));
		setMinutesError("");
	}, [limit]);
	const commitMinutes = () => {
		const value = Number(minutes);
		if (
			!Number.isInteger(value) ||
			value < rules.timeLimitMinutesMin ||
			value > rules.timeLimitMinutesMax
		) {
			setMinutesError("Enter a whole number from 1 to 30");
			return;
		}
		setMinutesError("");
		if (value !== limit)
			command("UPDATE_ROOM_SETTINGS", {
				mode: "TIME_LIMIT",
				timeLimitMinutes: value,
			});
	};
	return (
		<>
			<RoomCode roomId={room.roomId} />
			{room.state === "COUNTDOWN" && <p role="status">Starting…</p>}
			<ul className="players">
				{room.members.map((member) => (
					<li key={member.playerId}>
						<span>{member.nickname}</span>
						<span>
							{member.playerId === room.hostPlayerId ? "Host" : ""}
							{!member.connected ? " · Offline" : ""}
							{member.nextMatchConfirmed ? " · Confirmed" : ""}
						</span>
					</li>
				))}
			</ul>
			{room.settings && (
				<>
					<label className="mode-setting">
						Map
						<select
							aria-label="Map"
							value={room.settings.mapLevel ?? 10}
							disabled={!host || room.state !== "WAITING" || pending}
							onChange={(event) =>
								command("UPDATE_ROOM_SETTINGS", {
									mapLevel: Number(event.target.value),
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
						Visibility
						<select
							aria-label="Visibility"
							value={room.visibility || "PRIVATE"}
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
						Mode
						<select
							aria-label="Mode"
							value={room.settings.mode}
							disabled={!host || room.state !== "WAITING" || pending}
							onChange={(event) =>
								command("UPDATE_ROOM_SETTINGS", {
									mode: event.target.value,
									timeLimitMinutes:
										event.target.value === "TIME_LIMIT"
											? rules.timeLimitDefaultMinutes
											: null,
								})
							}
						>
							<option value="RACE">Race</option>
							<option value="HARDCORE">Hardcore</option>
							<option value="TIME_LIMIT">Time Limit</option>
							<option value="NO_WALK">No Walk</option>
						</select>
					</label>
					<ItemSettings
						value={room.settings}
						disabled={!host || room.state !== "WAITING" || pending}
						onChange={(patch) => command("UPDATE_ROOM_SETTINGS", patch)}
					/>
					{room.settings.mode === "TIME_LIMIT" && (
						<label className="mode-setting">
							Minutes
							<input
								type="number"
								min={rules.timeLimitMinutesMin}
								max={rules.timeLimitMinutesMax}
								value={minutes}
								disabled={!host || room.state !== "WAITING" || pending}
								onChange={(event) => setMinutes(event.currentTarget.value)}
								onBlur={commitMinutes}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										event.currentTarget.blur();
									}
								}}
							/>
							{minutesError && <small role="alert">{minutesError}</small>}
						</label>
					)}
				</>
			)}
			{host && room.state === "WAITING" && (
				<button
					type="button"
					disabled={
						pending ||
						room.members.filter(
							(member) =>
								member.connected && member.nextMatchConfirmed !== false,
						).length < rules.minimumRoomPlayers
					}
					onClick={() => command("START_GAME")}
				>
					Start
				</button>
			)}
			<button
				type="button"
				disabled={pending}
				onClick={() => command("LEAVE_ROOM")}
			>
				Leave
			</button>
		</>
	);
}
