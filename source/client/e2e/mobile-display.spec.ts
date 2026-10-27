import { expect, test } from "@playwright/test";

for (const kind of ["mobile", "desktop", "unsupported"] as const)
	test(`automatic mobile display handles ${kind} browser capabilities`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			viewport: { width: 844, height: 390 },
			hasTouch: kind !== "desktop",
			isMobile: kind !== "desktop",
		});
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.addInitScript((kind) => {
			const state = { fullscreen: false, requests: 0, locks: [] as string[] };
			Object.assign(window, { displayProbe: state });
			Object.defineProperty(document, "fullscreenElement", {
				get: () => (state.fullscreen ? document.documentElement : null),
			});
			Object.defineProperty(Element.prototype, "requestFullscreen", {
				value:
					kind === "unsupported"
						? undefined
						: async () => {
								state.requests++;
								if (!navigator.userActivation.isActive)
									throw new DOMException("Gesture required", "NotAllowedError");
								state.fullscreen = true;
							},
			});
			Object.defineProperty(screen.orientation, "lock", {
				value:
					kind === "unsupported"
						? undefined
						: async (orientation: string) => {
								if (!state.fullscreen)
									throw new DOMException(
										"Fullscreen required",
										"SecurityError",
									);
								state.locks.push(orientation);
							},
			});
			Object.defineProperty(screen.orientation, "unlock", { value: () => {} });
		}, kind);
		try {
			await page.goto("/");
			await expect(
				page.getByRole("button", { name: "New Game", exact: true }),
			).toBeVisible();
			await page.getByRole("button", { name: "New Game", exact: true }).click();
			await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
			const state = await page.evaluate(
				() =>
					(
						window as unknown as {
							displayProbe: { requests: number; locks: string[] };
						}
					).displayProbe,
			);
			expect(state.requests).toBe(kind === "mobile" ? 1 : 0);
			expect(state.locks).toEqual(kind === "mobile" ? ["landscape"] : []);
			await expect(
				page.getByRole("button", { name: "Rotate Screen" }),
			).toHaveCount(0);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
