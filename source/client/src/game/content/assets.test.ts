import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { type AssetManifest, assetUrl } from "./assets";

const root = new URL("../../../public/assets/", import.meta.url);
const manifest: AssetManifest = JSON.parse(
	readFileSync(new URL("manifest.json", root), "utf8"),
);
test("manifest references match actual files and hashes", () => {
	const referenced = new Set([
		...Object.values(manifest.textures).map((asset) => asset.file),
		...Object.values(manifest.sounds).map((asset) => asset.file),
		...Object.values(manifest.fonts).flatMap((font) => [
			font.texture,
			font.data,
		]),
		"font/ttf_litter_lover2_bold.ttf",
	]);
	expect(new Set(Object.keys(manifest.hashes))).toEqual(referenced);
	for (const file of referenced) {
		const buffer = readFileSync(new URL(file, root));
		expect(createHash("sha256").update(buffer).digest("hex"), file).toBe(
			manifest.hashes[file],
		);
	}
	const files = readdirSync(root, { recursive: true }).filter((file) =>
		/\.(png|ogg|ttf|xml)$/.test(String(file)),
	);
	expect(
		new Set(files.map((file) => String(file).replaceAll("\\", "/"))),
	).toEqual(referenced);
});
test("resource paths cannot escape assets", () => {
	expect(assetUrl("audio/menu song.ogg")).toBe("/assets/audio/menu%20song.ogg");
	for (const value of [
		"../secret",
		"/absolute",
		"https://example.test/a",
		"a\\b",
		"a//b",
	])
		expect(() => assetUrl(value)).toThrow();
	expect(manifest.screens).toHaveLength(43);
});
test("every screen and NPC references an included texture", () => {
	for (const screen of manifest.screens) {
		for (const key of screen.layers)
			expect(manifest.textures[key], key).toBeDefined();
		for (const prop of screen.props)
			if (prop.texture)
				expect(manifest.textures[prop.texture], prop.texture).toBeDefined();
		for (const weather of screen.weather)
			if (weather.mask)
				expect(manifest.textures[weather.mask], weather.mask).toBeDefined();
		const layers = screen.scrolling?.ScrollingBGdata?.layers?.Layer;
		for (const layer of layers
			? Array.isArray(layers)
				? layers
				: [layers]
			: [])
			expect(
				manifest.textures[`screens/scrolling/textures/${layer.texture}`],
			).toBeDefined();
	}
	for (const npc of manifest.npcs)
		expect(manifest.textures[npc.texture], npc.name).toBeDefined();
});
