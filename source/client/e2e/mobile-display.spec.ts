import { expect, test } from "@playwright/test";

for (const kind of ["mobile", "desktop", "unsupported"] as const)
	test(`landscape layout remains usable on ${kind} browser`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			viewport:
				kind === "desktop"
					? { width: 390, height: 844 }
					: { width: 844, height: 390 },
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
								document.dispatchEvent(new Event("fullscreenchange"));
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
			if (kind === "mobile")
				await expect(
					page.getByRole("button", { name: "Enter full screen" }),
				).toBeVisible();
			if (kind === "mobile") {
				await page.getByRole("button", { name: "Enter full screen" }).click();
				await expect(
					page.getByRole("button", { name: "Enter full screen" }),
				).toBeHidden();
			}
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
			if (kind === "mobile") {
				expect(state.requests).toBeGreaterThan(0);
				expect(state.locks).toContain("landscape");
			} else {
				expect(state.requests).toBe(0);
				expect(state.locks).toEqual([]);
			}
			if (kind === "mobile")
				await expect(
					page.getByRole("button", { name: "Enter full screen" }),
				).toBeHidden();
			await expect(
				page.getByRole("button", { name: "Rotate Screen" }),
			).toHaveCount(0);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});

for (const viewport of [
	{ width: 390, height: 844 },
	{ width: 320, height: 568 },
])
	for (const capability of ["missing", "rejected", "legacy"] as const)
		test(`portrait mobile is blocked with ${capability} orientation lock at ${viewport.width}px`, async ({
			browser,
		}, info) => {
			const context = await browser.newContext({
				viewport,
				hasTouch: true,
				isMobile: true,
			});
			try {
				const page = await context.newPage();
				const errors: string[] = [];
				page.on("pageerror", (error) => errors.push(error.message));
				page.on("console", (message) => {
					if (message.type() === "error") errors.push(message.text());
				});
				await page.route("**/api/auth/me", (route) =>
					route.fulfill({ json: { authenticated: false, account: null } }),
				);
				await page.addInitScript((capability) => {
					const probe = { locks: 0 };
					Object.assign(window, { orientationProbe: probe });
					Object.defineProperty(Element.prototype, "requestFullscreen", {
						value: undefined,
					});
					if (capability === "legacy") {
						Object.defineProperty(screen, "orientation", { value: undefined });
						return;
					}
					Object.defineProperty(screen.orientation, "lock", {
						value:
							capability === "missing"
								? undefined
								: async () => {
										probe.locks++;
										throw new DOMException("Lock rejected", "NotAllowedError");
									},
					});
				}, capability);
				await page.goto("/");
				const gate = page.getByRole("dialog", { name: "Landscape required" });
				await expect(gate).toBeVisible();
				await expect(
					page.getByRole("button", { name: "Enter full screen" }),
				).toBeVisible();
				await page.getByRole("button", { name: "Try landscape" }).click();
				const lockAttempts = await page.evaluate(
					() =>
						(window as unknown as { orientationProbe: { locks: number } })
							.orientationProbe.locks,
				);
				if (capability === "rejected") expect(lockAttempts).toBeGreaterThan(0);
				else expect(lockAttempts).toBe(0);
				await expect(page.locator(".app-content")).toHaveAttribute("inert", "");
				await expect(page.locator(".home")).toBeHidden();
				await page.keyboard.press("Tab");
				expect(
					await page.evaluate(() =>
						document.activeElement?.closest(".app-content"),
					),
				).toBeNull();
				expect(
					await page.evaluate(
						() => document.documentElement.scrollHeight <= innerHeight,
					),
				).toBe(true);
				if (viewport.width === 390 && capability === "missing")
					await page.screenshot({
						path: info.outputPath("portrait-blocked.png"),
					});
				await page.setViewportSize({
					width: viewport.height,
					height: viewport.width,
				});
				await expect(gate).toBeHidden();
				await page
					.getByRole("button", { name: "New Game", exact: true })
					.click();
				const username = page.getByLabel("Username", { exact: true });
				await username.fill("Unsent draft");
				await page.setViewportSize(viewport);
				await expect(gate).toBeVisible();
				await expect(username).toBeHidden();
				await page.setViewportSize({
					width: viewport.height,
					height: viewport.width,
				});
				await expect(gate).toBeHidden();
				await expect(username).toHaveValue("Unsent draft");
				await page.getByRole("button", { name: "Back", exact: true }).click();
				await expect(
					page.getByRole("button", { name: "New Game", exact: true }),
				).toBeVisible();
				if (viewport.width === 390 && capability === "missing")
					await page.screenshot({
						path: info.outputPath("landscape-unblocked.png"),
					});
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});

test("a shorter viewport cannot bypass a physical portrait lock", async ({
	browser,
}) => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	});
	try {
		const page = await context.newPage();
		await page.addInitScript(() => {
			Object.defineProperty(screen.orientation, "type", {
				value: "portrait-primary",
			});
		});
		await page.goto("/");
		const gate = page.getByRole("dialog", { name: "Landscape required" });
		await expect(gate).toBeVisible();
		await page.setViewportSize({ width: 390, height: 300 });
		await expect(gate).toBeVisible();
		await expect(page.locator(".app-content")).toHaveAttribute("inert", "");
	} finally {
		await context.close();
	}
});

test("legacy portrait detection ignores a shorter virtual keyboard viewport", async ({
	browser,
}) => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	});
	try {
		const page = await context.newPage();
		await page.addInitScript(() => {
			Object.defineProperty(screen, "orientation", { value: undefined });
			Object.defineProperty(screen, "width", { value: 390 });
			Object.defineProperty(screen, "height", { value: 844 });
		});
		await page.goto("/");
		const gate = page.getByRole("dialog", { name: "Landscape required" });
		await expect(gate).toBeVisible();
		await page.setViewportSize({ width: 390, height: 300 });
		await expect(gate).toBeVisible();
	} finally {
		await context.close();
	}
});
