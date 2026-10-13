import type { ConfigEnv } from "vite";
import { afterEach, expect, test } from "vitest";
import configuration from "../../vite.config";

const originalFly = process.env.FLY_ENABLED;
afterEach(() => {
	if (originalFly === undefined) delete process.env.FLY_ENABLED;
	else process.env.FLY_ENABLED = originalFly;
});

test("production and preview cannot enable Solo fly even with the environment flag", async () => {
	process.env.FLY_ENABLED = "true";
	const config = configuration as (env: ConfigEnv) => {
		define: Record<string, string>;
	};
	expect(
		config({ command: "build", mode: "production" }).define
			.__SOLO_FLY_ENABLED__,
	).toBe("false");
	expect(
		config({ command: "serve", mode: "production", isPreview: true }).define
			.__SOLO_FLY_ENABLED__,
	).toBe("false");
	expect(
		config({ command: "serve", mode: "development" }).define
			.__SOLO_FLY_ENABLED__,
	).toBe("true");
});
