import rules from "../../../../common/rules.json";
import type { RoomItemSettings } from "../../game/items";

export function ItemSettings({
	value,
	disabled,
	onChange,
}: {
	value: RoomItemSettings;
	disabled: boolean;
	onChange: (patch: Partial<RoomItemSettings>) => void;
}) {
	return (
		<>
			<label className="mode-setting item-toggle">
				<span>Items</span>
				<input
					type="checkbox"
					aria-label="Items"
					checked={value.itemsEnabled}
					disabled={disabled}
					onChange={(event) => onChange({ itemsEnabled: event.target.checked })}
				/>
			</label>
			{value.itemsEnabled && (
				<label className="mode-setting">
					Item Cooldown
					<select
						aria-label="Item Cooldown"
						value={value.itemCooldownMinutes}
						disabled={disabled}
						onChange={(event) =>
							onChange({ itemCooldownMinutes: Number(event.target.value) })
						}
					>
						{Array.from(
							{
								length:
									rules.items.cooldownMaxMinutes -
									rules.items.cooldownMinMinutes +
									1,
							},
							(_, i) => i + rules.items.cooldownMinMinutes,
						).map((minutes) => (
							<option key={minutes} value={minutes}>
								{minutes} min
							</option>
						))}
					</select>
				</label>
			)}
		</>
	);
}
