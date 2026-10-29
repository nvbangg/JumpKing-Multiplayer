import { Users } from "lucide-react";
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
	onWatch: (id: string | null) => void;
}) {
	return (
		<details
			open
			className="in-game-panel players-panel"
			aria-label="Players ranking"
		>
			<summary>
				<h2>
					<Users className="tone-cyan" aria-hidden="true" />
					Players
				</h2>
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
							aria-pressed={player.playerId === (watchingId ?? selfId)}
							disabled={
								disabled ||
								(player.playerId === selfId && !watchingId) ||
								!watchableIds.includes(player.playerId)
							}
							onClick={() =>
								onWatch(player.playerId === selfId ? null : player.playerId)
							}
							style={{
								color:
									rules.appearanceColors[
										player.colorSlot % rules.appearanceColors.length
									],
							}}
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
