import { expect, test } from "@playwright/test";

test("Main Babe textures decode in a browser and audio/font resources load", async ({
	page,
	request,
}) => {
	const response = await request.get("/assets/manifest.json");
	expect(response.ok()).toBe(true);
	const manifest = await response.json();
	await page.goto("/");
	const failures = await page.evaluate(async (textures) => {
		const failed: string[] = [];
		for (const texture of Object.values(textures) as {
			file: string;
			width: number;
			height: number;
		}[]) {
			const image = new Image();
			image.src = `/assets/${texture.file}`;
			try {
				await image.decode();
				if (
					image.naturalWidth !== texture.width ||
					image.naturalHeight !== texture.height
				)
					failed.push(texture.file);
			} catch {
				failed.push(texture.file);
			}
		}
		return failed;
	}, manifest.textures);
	expect(failures).toEqual([]);
	for (const asset of Object.values(manifest.sounds) as { file: string }[])
		expect((await request.get(`/assets/${asset.file}`)).ok()).toBe(true);
	expect(
		(await request.get("/assets/font/ttf_litter_lover2_bold.ttf")).ok(),
	).toBe(true);
});
