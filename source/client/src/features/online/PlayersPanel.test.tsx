import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { PlayersPanel } from "./PlayersPanel";
import { RockIcon } from "./RockIcon";

function button(
	node: ReactNode,
	label: string,
): { disabled: boolean; onClick: () => void } | undefined {
	for (const child of Children.toArray(node)) {
		if (
			!isValidElement<{
				children?: ReactNode;
				"aria-label"?: string;
				disabled: boolean;
				onClick: () => void;
			}>(child)
		)
			continue;
		if (child.type === "button" && child.props["aria-label"] === label)
			return child.props;
		const result = button(child.props.children, label);
		if (result) return result;
	}
}

test("self is selectable while watching a peer, and switches cameras through the existing callback", () => {
	const onWatch = vi.fn();
	const props = {
		players: ["self", "peer"].map((playerId) => ({
			playerId,
			nickname: playerId,
			colorSlot: 0,
			rank: 1,
			currentProgress: 0,
		})),
		selfId: "self",
		watchableIds: ["self", "peer"],
		disabled: false,
		onWatch,
	};
	const own = button(
		PlayersPanel({ ...props, watchingId: "peer" }),
		"Watch self",
	);
	expect(own?.disabled).toBe(false);
	own?.onClick();
	expect(onWatch).toHaveBeenLastCalledWith(null);
	button(PlayersPanel(props), "Watch peer")?.onClick();
	expect(onWatch).toHaveBeenLastCalledWith("peer");
	expect(button(PlayersPanel(props), "Watch self")?.disabled).toBe(true);
});

test("Rock has a dedicated pixel silhouette at the current HUD icon size", () => {
	const html = renderToStaticMarkup(<RockIcon />);
	expect(html).toContain('width="24"');
	expect(html).toContain('height="24"');
	expect(html).toContain('shape-rendering="crispEdges"');
	expect(html).not.toContain("lucide-mountain");
});
