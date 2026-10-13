import rules from "../../../../common/rules.json";
import type { PlayerStanding } from "../../network/contracts";

export function PlayersPanel({
	players,
	selfId,
}: {
	players: PlayerStanding[];
	selfId: string | null;
}) {
	return (
		<details className="in-game-panel" aria-label="Players ranking">
			<summary>Players</summary>
			<ol aria-label="Current players">
				{players.map((player) => (
					<li
						key={player.playerId}
						className={player.playerId === selfId ? "self-result" : undefined}
					>
						<span style={{ color: rules.appearanceColors[player.colorSlot] }}>
							{player.rank}. {player.nickname}
						</span>
						<strong>{Math.floor(player.currentProgress)} px</strong>
					</li>
				))}
			</ol>
		</details>
	);
}
