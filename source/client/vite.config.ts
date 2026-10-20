import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const sharedFiles = [
	"maps/main-babe.json",
	"physics.json",
	"rules.json",
	"adventure.json",
];
const sharedRoot = new URL("../common/", import.meta.url);

export default defineConfig(({ mode }) => {
	const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
	const version = env.GITHUB_SHA || randomUUID();
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
		define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(version) },
		plugins: [
			react(),
			{
				name: "release-version",
				configureServer(server) {
					server.middlewares.use((req, res, next) => {
						if (req.url?.split("?")[0] !== "/version.json") return next();
						res.setHeader("Content-Type", "application/json");
						res.setHeader("Cache-Control", "no-store");
						res.end(JSON.stringify({ version }));
					});
				},
				generateBundle() {
					this.emitFile({
						type: "asset",
						fileName: "version.json",
						source: JSON.stringify({ version }),
					});
				},
			},
			{
				name: "shared-game-data",
				configureServer(server) {
					server.middlewares.use((req, res, next) => {
						if (!req.url?.startsWith("/shared/")) return next();
						const [file = ""] = req.url.slice("/shared/".length).split("?");
						if (!sharedFiles.includes(file)) {
							res.statusCode = 404;
							res.end();
							return;
						}
						try {
							res.setHeader("Content-Type", "application/json");
							res.end(readFileSync(new URL(file, sharedRoot)));
						} catch {
							res.statusCode = 503;
							res.end("Game data is unavailable");
						}
					});
				},
				generateBundle() {
					for (const file of sharedFiles) {
						this.emitFile({
							type: "asset",
							fileName: `shared/${file}`,
							source: readFileSync(fileURLToPath(new URL(file, sharedRoot))),
						});
					}
				},
			},
		],
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
