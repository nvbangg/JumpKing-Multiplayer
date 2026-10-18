export interface TextureInfo {
	file: string;
	width: number;
	height: number;
}
export interface Prop {
	type: string;
	Position: { X: number; Y: number };
	texture: string | null;
	cells: { X: number; Y: number };
	fps: number;
	durations: number[];
	flipped?: boolean;
}
export interface VisualScreen {
	layers: string[];
	props: Prop[];
	location: string;
	ambience: { name: string; volume: number }[];
	weather: {
		name: string;
		fps: number;
		foreground?: boolean;
		mask: string | null;
	}[];
	scrolling: {
		ScrollingBGdata?: {
			scroll_speed: number;
			layers?: { Layer: ScrollLayer | ScrollLayer[] };
		};
	} | null;
}
export interface ScrollLayer {
	texture: string;
	position: number;
	scroll_multiplier: number;
	foreground?: boolean;
}
export interface Npc {
	name: string;
	screen: number;
	texture: string;
	font: string;
	position: { X: number; Y: number };
	cells: { X: number; Y: number };
	busy: { sprite_index: number; duration: number }[];
	talking: { sprite_index: number; duration: number }[];
	intro: string[];
	looping: string[][];
	screenQuotes: { screen: number; lines: string[] }[];
	flagQuotes: { flag: string; quotes: string[][] }[];
	bubble: { direction: string; width: number };
}
export interface AssetManifest {
	screens: VisualScreen[];
	textures: Record<string, TextureInfo>;
	sounds: Record<string, { file: string; duration: number }>;
	fonts: Record<string, { texture: string; data: string; lineHeight: number }>;
	hashes: Record<string, string>;
	npcs: Npc[];
	crown: string;
	messages: {
		id: string;
		screen: number;
		font: string;
		lines: string[];
		anchor: { x: number; y: number };
		bubble: {
			direction: string;
			width: number;
			anchor: { X: string; Y: string };
		};
	}[];
	walls: {
		id: string;
		screen: number;
		texture: string;
		position: { X: number; Y: number };
		appearSound: string | null;
		disappearSound: string | null;
	}[];
}
export function assetUrl(file: string): string {
	if (
		!file ||
		file
			.split("/")
			.some((segment) => !segment || segment === "." || segment === "..") ||
		file.includes("\\") ||
		file.includes(":")
	)
		throw new Error("Invalid asset path");
	return `/assets/${file.split("/").map(encodeURIComponent).join("/")}`;
}
export async function loadManifest(
	signal?: AbortSignal,
): Promise<AssetManifest> {
	const response = await fetch("/assets/manifest.json", { signal });
	if (!response.ok) throw new Error("Game assets could not be loaded");
	const manifest: AssetManifest = await response.json();
	if (
		manifest.screens?.length !== 43 ||
		!manifest.textures?.["king/base"] ||
		!manifest.textures?.title_logo ||
		!manifest.hashes
	)
		throw new Error("Invalid game assets");
	for (const file of Object.keys(manifest.hashes)) assetUrl(file);
	return manifest;
}
