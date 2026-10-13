import type { Page } from "@playwright/test";

/** Đọc counters đã lưu thật, không phụ thuộc HUD có hiển thị số lần nhảy hay không. */
export async function soloJumps(page: Page): Promise<number | null> {
	return page.evaluate(async () => {
		const path = "/src/features/solo/storage.ts";
		const { currentSolo } = await import(path);
		return (await currentSolo("guest"))?.jumps ?? null;
	});
}
