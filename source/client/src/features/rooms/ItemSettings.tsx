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
		<label className="mode-setting">
			Items cooldown
			<select
				aria-label="Items cooldown"
				value={value.itemCooldownMinutes ?? "OFF"}
				disabled={disabled}
				onChange={(event) => {
					onChange({
						itemCooldownMinutes:
							event.target.value === "OFF" ? null : Number(event.target.value),
					});
				}}
			>
				<option value="OFF">No items</option>
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
	);
}
