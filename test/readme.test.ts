import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const readme = readFileSync(new URL("README.md", root), "utf8");

test("README tidak memakai blok Mermaid, karena npmjs.com tidak merendernya", () => {
	assert.equal(readme.includes("```mermaid"), false);
});

test("setiap gambar README ada di docs/diagrams, dengan alamat absolut dan teks alternatif", () => {
	const gambar = [...readme.matchAll(/<img src="([^"]+)"[^>]*alt="([^"]+)"/g)];
	assert.ok(gambar.length >= 3, "README harus memuat diagram");
	for (const [, src, alt] of gambar) {
		assert.match(
			src as string,
			/^https:\/\/raw\.githubusercontent\.com\/dianramdhani\/rempug\/main\/docs\/diagrams\/[a-z-]+\.png$/,
		);
		assert.ok((alt as string).length > 30, `alt terlalu pendek: ${src}`);
		const berkas = (src as string).split("/").pop() as string;
		assert.ok(
			existsSync(new URL(`docs/diagrams/${berkas}`, root)),
			`${berkas} tidak ada`,
		);
	}
});

test("setiap sumber .mmd punya PNG dengan nama sama, dan PNG itu berkas PNG sungguhan", () => {
	for (const nama of ["gambaran-besar", "satu-tugas", "tangga-masalah"]) {
		assert.ok(
			existsSync(new URL(`docs/diagrams/${nama}.mmd`, root)),
			`${nama}.mmd`,
		);
		const png = readFileSync(new URL(`docs/diagrams/${nama}.png`, root));
		assert.deepEqual(
			[...png.subarray(0, 8)],
			[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
			`${nama}.png`,
		);
	}
});
