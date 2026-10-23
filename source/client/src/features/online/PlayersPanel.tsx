import rules from "../../../../common/rules.json";
import type { PlayerStanding } from "../../network/contracts";

export function PlayersPanel({
	players,
	selfId,
	watchingId,
	watchableIds,
	disabled,
	onWatch,
}: {
	players: PlayerStanding[];
	selfId: string | null;
	watchingId?: string;
	watchableIds: string[];
	disabled: boolean;
	onWatch: (id: string) => void;
}) {
	return (
		<details
			open
			className="in-game-panel players-panel"
			aria-label="Players ranking"
		>
			<summary>
				<h2>Players</h2>
			</summary>
			<ol aria-label="Current players">
				{players.map((player) => (
					<li
						key={player.playerId}
						className={player.playerId === selfId ? "self-result" : undefined}
					>
						<button
							type="button"
							className="watch-player"
							aria-label={`Watch ${player.nickname}`}
							aria-pressed={player.playerId === watchingId}
							disabled={
								disabled ||
								player.playerId === selfId ||
								!watchableIds.includes(player.playerId)
							}
							onClick={() => onWatch(player.playerId)}
							style={{ color: rules.appearanceColors[player.colorSlot] }}
						>
							{player.rank}. {player.nickname}
						</button>
						<strong>{Math.floor(player.currentProgress)} px</strong>
					</li>
				))}
			</ol>
		</details>
	);
}
