import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
	const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
	const target = env.BACKEND_URL || "http://127.0.0.1:8080";
	const url = new URL(target);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.pathname !== "/" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(
			"BACKEND_URL must be an HTTP origin without credentials or a path",
		);
	}
	return {
		plugins: [react()],
		server: {
			host: true,
			port: 5173,
			strictPort: true,
			proxy: {
				"/api": { target, changeOrigin: false },
				"/ws": { target, ws: true, changeOrigin: false },
			},
		},
		test: { include: ["src/**/*.test.{ts,tsx}"] },
	};
});
