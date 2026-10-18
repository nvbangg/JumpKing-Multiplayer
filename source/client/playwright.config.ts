import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
	throw new Error("Invalid E2E_PORT");
const localUrl = `http://127.0.0.1:${port}`;
export default defineConfig({
	testDir: "./e2e",
	outputDir: process.env.E2E_OUTPUT_DIR || "test-results",
	fullyParallel: true,
	workers: 2,
	use: {
		baseURL: process.env.E2E_BASE_URL || localUrl,
		trace: "retain-on-failure",
		launchOptions: process.env.E2E_BROWSER_PATH
			? { executablePath: process.env.E2E_BROWSER_PATH }
			: {},
	},
	webServer: process.env.E2E_BASE_URL
		? undefined
		: {
				command: `npm run dev -- --port ${port}`,
				url: localUrl,
				reuseExistingServer: !process.env.CI && !process.env.E2E_PORT,
			},
});
