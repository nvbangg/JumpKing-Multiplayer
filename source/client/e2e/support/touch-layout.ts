import { expect, type Page } from "@playwright/test";

/** Đo cùng một frame để tránh lệch giữa các lần đọc layout khi nhận snapshot. */
export async function expectTouchLayout(page: Page) {
	const boxes = await page.locator(".play-page").evaluate((root) => {
		const box = (selector: string) => {
			const element = root.querySelector(selector);
			if (!element) throw new Error(`Missing layout element: ${selector}`);
			const { x, y, width, height, right, bottom } =
				element.getBoundingClientRect();
			return { x, y, width, height, right, bottom };
		};
		return {
			chat: box(".game-chat .chat-input-box"),
			panel: box(
				root.querySelector(".records-panel")
					? ".records-panel"
					: ".players-panel",
			),
			sidebar: box(".game-sidebar"),
			stage: box(".game-stage"),
			directions: box(".touch-controls > div"),
			left: box('button[aria-label="Move Left"]'),
			right: box('button[aria-label="Move Right"]'),
			jump: box('button[aria-label="Jump"]'),
		};
	});
	const equal = (actual: number, expected: number) =>
		expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.5);
	for (const edge of ["x", "right", "width"] as const) {
		equal(boxes.directions[edge], boxes.chat[edge]);
		equal(boxes.jump[edge], boxes.panel[edge]);
	}
	for (const edge of ["y", "bottom", "height"] as const)
		equal(boxes.directions[edge], boxes.jump[edge]);
	equal(boxes.left.width, boxes.right.width);
	equal(boxes.left.height, boxes.right.height);
	equal(boxes.left.x, boxes.directions.x);
	equal(boxes.right.right, boxes.directions.right);
	equal(boxes.right.x - boxes.left.right, 8);
	equal(boxes.directions.y - boxes.chat.bottom, 8);
	equal(boxes.jump.y - boxes.sidebar.bottom, 8);
	for (const button of [boxes.left, boxes.right, boxes.jump]) {
		expect(button.width).toBeGreaterThanOrEqual(44);
		expect(button.height).toBeGreaterThanOrEqual(44);
	}
	expect(boxes.directions.right).toBeLessThanOrEqual(boxes.stage.x);
	expect(boxes.jump.x).toBeGreaterThanOrEqual(boxes.stage.right);
	return boxes;
}
