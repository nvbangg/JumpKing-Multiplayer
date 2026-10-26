import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { RoomMember, RoomState } from "../../network/GameSocket";
import { ItemSettings } from "./ItemSettings";
import { Lobby } from "./Lobby";

const member = (playerId: string): RoomMember => ({
	playerId,
	nickname: playerId,
	username: playerId,
	colorSlot: 0,
	connected: true,
	paused: null,
	nextMatchConfirmed: true,
});
const room: RoomState = {
	roomId: "001234",
	kind: "ROOM",
	state: "WAITING",
	hostPlayerId: "host",
	visibility: "PRIVATE",
	settings: {
		mode: "RACE",
		timeLimitMinutes: null,
		mapId: 1,
		itemCooldownMinutes: null,
	},
	members: [member("host")],
	currentPlay: null,
	result: null,
};

function markup(value = room, selfId = "host", pending = false) {
	return renderToStaticMarkup(
		<Lobby room={value} selfId={selfId} pending={pending} command={() => {}} />,
	);
}

function findButton(node: ReactNode, label: string): (() => void) | undefined {
	for (const child of Children.toArray(node)) {
		if (
			!isValidElement<{
				children?: ReactNode;
				"aria-label"?: string;
				onClick?: () => void;
			}>(child)
		)
			continue;
		if (
			child.type === "button" &&
			(child.props["aria-label"] === label || child.props.children === label)
		)
			return child.props.onClick;
		const match = findButton(child.props.children, label);
		if (match) return match;
	}
}

function findSelect(
	node: ReactNode,
	label: string,
): ((event: never) => void) | undefined {
	for (const child of Children.toArray(node)) {
		if (
			!isValidElement<{
				children?: ReactNode;
				"aria-label"?: string;
				onChange?: (event: never) => void;
			}>(child)
		)
			continue;
		if (child.type === "select" && child.props["aria-label"] === label)
			return child.props.onChange;
		const match = findSelect(child.props.children, label);
		if (match) return match;
	}
}

test("a confirmed host can start alone, while an unconfirmed host cannot start", () => {
	expect(markup()).toContain('<button type="button">Start</button>');
	const waiting = {
		...room,
		members: [{ ...member("host"), nextMatchConfirmed: false }, member("peer")],
	};
	expect(markup(waiting)).toContain(
		'<button type="button" disabled="">Start</button>',
	);
	expect(markup(room, "host", true)).toContain(
		'<button type="button" disabled="">Start</button>',
	);
	expect(
		markup({ ...room, members: [...room.members, member("peer")] }, "peer"),
	).not.toContain(">Start</button>");
});

test("time limit and item cooldown choices stop at ten minutes", () => {
	expect(markup()).toContain(
		'<option value="UNLIMITED" selected="">Unlimited</option>',
	);
	expect(markup()).toContain(
		'<option value="OFF" selected="">No items</option>',
	);
	const configured: RoomState = {
		...room,
		settings: {
			...room.settings,
			mode: "RACE",
			timeLimitMinutes: 10,
			mapId: 1,
			itemCooldownMinutes: 10,
		},
	};
	const html = markup(configured);
	expect(html).toContain('<option value="10" selected="">10 min</option>');
	expect(
		html.match(/<option value="10"(?: selected="")?>10 min<\/option>/g),
	).toHaveLength(2);
	expect(html).not.toContain('<option value="11">11 min</option>');
});

test("dropdowns update unlimited, time limit, and item settings independently", () => {
	const command = vi.fn();
	const tree = Lobby({ room, selfId: "host", pending: false, command });
	if (!room.settings) throw new Error("Room settings are missing");
	const itemSettings = ItemSettings({
		value: room.settings,
		disabled: false,
		onChange: (patch) => command("UPDATE_ROOM_SETTINGS", patch),
	});
	findSelect(tree, "Time Limit")?.({ target: { value: "UNLIMITED" } } as never);
	expect(command).toHaveBeenLastCalledWith("UPDATE_ROOM_SETTINGS", {
		timeLimitMinutes: null,
	});
	findSelect(tree, "Time Limit")?.({ target: { value: "7" } } as never);
	expect(command).toHaveBeenLastCalledWith("UPDATE_ROOM_SETTINGS", {
		timeLimitMinutes: 7,
	});
	findSelect(
		itemSettings,
		"Items cooldown",
	)?.({ target: { value: "OFF" } } as never);
	expect(command).toHaveBeenLastCalledWith("UPDATE_ROOM_SETTINGS", {
		itemCooldownMinutes: null,
	});
	findSelect(
		itemSettings,
		"Items cooldown",
	)?.({ target: { value: "2" } } as never);
	expect(command).toHaveBeenLastCalledWith("UPDATE_ROOM_SETTINGS", {
		itemCooldownMinutes: 2,
	});
});

test("confirmation controls exist in the first lobby and follow server state", () => {
	const command = vi.fn();
	const render = (value: RoomState) =>
		Lobby({ room: value, selfId: "host", pending: false, command });
	expect(markup()).toContain(">Cancel Confirm</button>");
	expect(markup()).not.toContain("Play Again");
	findButton(render(room), "Cancel Confirm")?.();
	expect(command).toHaveBeenLastCalledWith("SET_ROOM_CONFIRMED", {
		confirmed: false,
	});
	const cancelled = {
		...room,
		members: [{ ...member("host"), nextMatchConfirmed: false }],
	};
	for (let update = 0; update < 2; update++) {
		expect(markup(cancelled)).toContain(">Confirm</button>");
		expect(markup(cancelled)).not.toContain(">Cancel Confirm</button>");
	}
	findButton(render(cancelled), "Confirm")?.();
	expect(command).toHaveBeenLastCalledWith("SET_ROOM_CONFIRMED", {
		confirmed: true,
	});
});

test("only the lobby host can kick another member, including an offline member", () => {
	const value = {
		...room,
		members: [member("host"), { ...member("peer"), connected: false }],
	};
	const html = markup(value);
	expect(html).toContain('aria-label="Kick peer"');
	expect(html).not.toContain('aria-label="Kick host"');
	expect(markup(value, "peer")).not.toContain('aria-label="Kick');
	const command = vi.fn();
	findButton(
		Lobby({ room: value, selfId: "host", pending: false, command }),
		"Kick peer",
	)?.();
	expect(command).toHaveBeenCalledWith("KICK_PLAYER", { playerId: "peer" });
});

test("the next Lobby hides members still at Results until they choose Play Again", () => {
	const host = { ...member("host"), nextMatchJoined: true };
	const peer = {
		...member("still-results"),
		nextMatchJoined: false,
		nextMatchConfirmed: false,
	};
	const value = {
		...room,
		members: [host, peer],
	};
	expect(markup(value)).not.toContain("still-results");
	expect(value.members).toHaveLength(2);
	const returned = {
		...value,
		members: [host, { ...peer, nextMatchJoined: true }],
	};
	expect(markup(returned)).toContain(">still-results</span>");
});

test("new members and returned members who cancel confirmation remain in the Lobby", () => {
	const value = {
		...room,
		members: [
			member("host"),
			member("new-peer"),
			{
				...member("cancelled-peer"),
				nextMatchJoined: true,
				nextMatchConfirmed: false,
			},
		],
	};
	const html = markup(value);
	expect(html).toContain(">new-peer</span>");
	expect(html).toContain(">cancelled-peer</span>");
	expect(markup(value, "cancelled-peer")).toContain(">Confirm</button>");
});

test("a host still at Results neither appears nor grants host controls to the Lobby", () => {
	const value = {
		...room,
		members: [
			{
				...member("host"),
				nextMatchJoined: false,
				nextMatchConfirmed: false,
			},
			{ ...member("peer"), nextMatchJoined: true },
		],
	};
	const peer = markup(value, "peer");
	expect(peer).not.toContain(">host</span>");
	expect(peer).not.toContain(">Start</button>");
	expect(peer).not.toContain('aria-label="Kick');
	expect(peer).toContain(">Cancel Confirm</button>");
	const absentHost = markup(value);
	expect(absentHost).not.toContain(">Start</button>");
	expect(absentHost).not.toContain(">Confirm</button>");
	expect(absentHost).not.toContain(">Cancel Confirm</button>");
	expect(absentHost).not.toContain('aria-label="Kick');
});

test("countdown hides confirmation, kick and start controls", () => {
	const html = markup({
		...room,
		state: "COUNTDOWN",
		members: [member("host"), member("peer")],
	});
	expect(html).not.toContain(">Cancel Confirm</button>");
	expect(html).not.toContain('aria-label="Kick');
	expect(html).not.toContain(">Start</button>");
});

test("mode descriptions use the requested text and preserve protocol values", () => {
	const html = markup();
	for (const [value, text] of [
		["RACE", "RACE – Default"],
		["EASY", "EASY – Respawn at Last Position"],
		["HARDCORE", "HARDCORE – Restart on Death"],
		["NO_WALK", "NO WALK – Jump Only"],
	])
		expect(html).toMatch(
			new RegExp(`<option value="${value}"[^>]*>${text}</option>`),
		);
	expect(html).not.toContain('<option value="TIME_LIMIT">');
});
