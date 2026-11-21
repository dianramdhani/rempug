import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBrief } from "../../src/core/brief.js";

const SECTIONS = ["TUJUAN", "CAKUPAN", "LANGKAH", "CEK", "BALASAN"] as const;

function brief(
	over: Partial<Record<(typeof SECTIONS)[number], string | null>> = {},
) {
	const isi: Record<string, string | null> = {
		TUJUAN: "Samakan kolom tabel Devices dengan acuan.",
		CAKUPAN: "edit src/features/device/**",
		LANGKAH: "1. Buka halaman acuan.\n2. Ubah kolom.",
		CEK: "yarn tsc -b\nyarn check",
		BALASAN: "hasil, bukti, blocker",
		...over,
	};
	return SECTIONS.filter((s) => isi[s] !== null && over[s] !== null)
		.map((s) => `${s}: ${isi[s]}`.replace(/^(\w+): (.*\n)/, "$1:\n$2"))
		.join("\n");
}

test("brief edit lengkap diurai ke bentuk terstruktur", () => {
	const r = parseBrief(
		[
			"TUJUAN: Samakan kolom tabel.",
			"CAKUPAN: edit src/features/device/**, src/lib/x.ts",
			"LANGKAH:",
			"1. Buka halaman acuan.",
			"2. Ubah kolom.",
			"CEK:",
			"yarn tsc -b",
			"yarn check",
			"BALASAN: hasil, bukti, blocker",
		].join("\n"),
	);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	assert.equal(r.brief.tujuan, "Samakan kolom tabel.");
	assert.deepEqual(r.brief.cakupan, {
		mode: "edit",
		paths: ["src/features/device/**", "src/lib/x.ts"],
	});
	assert.deepEqual(r.brief.langkah, ["Buka halaman acuan.", "Ubah kolom."]);
	assert.deepEqual(r.brief.cek, ["yarn tsc -b", "yarn check"]);
	assert.equal(r.brief.balasan, "hasil, bukti, blocker");
});

test("mode baca dan browser tanpa path; CEK '-' berarti kosong", () => {
	for (const mode of ["baca", "browser"] as const) {
		const r = parseBrief(
			`TUJUAN: Cek\nCAKUPAN: ${mode}\nLANGKAH:\n1. Lihat.\nCEK: -\nBALASAN: hasil`,
		);
		assert.equal(r.ok, true, mode);
		if (!r.ok) return;
		assert.deepEqual(r.brief.cakupan, { mode });
		assert.deepEqual(r.brief.cek, []);
	}
});

test("path dapat dipisah koma atau spasi", () => {
	const r = parseBrief(brief({ CAKUPAN: "edit src/a.ts   src/b.ts,src/c/**" }));
	assert.equal(r.ok, true);
	if (!r.ok) return;
	assert.deepEqual(r.brief.cakupan, {
		mode: "edit",
		paths: ["src/a.ts", "src/b.ts", "src/c/**"],
	});
});

test("setiap bagian yang hilang ditolak dan disebut namanya", () => {
	for (const bagian of SECTIONS) {
		const r = parseBrief(brief({ [bagian]: null }));
		assert.equal(r.ok, false, bagian);
		if (r.ok) return;
		assert.ok(
			r.errors.some((e) => e.includes(bagian)),
			`${bagian}: ${r.errors.join(" | ")}`,
		);
	}
});

test("semua bagian yang kurang dilaporkan sekaligus", () => {
	const r = parseBrief("TUJUAN: saja");
	assert.equal(r.ok, false);
	if (r.ok) return;
	for (const bagian of ["CAKUPAN", "LANGKAH", "CEK", "BALASAN"])
		assert.ok(
			r.errors.some((e) => e.includes(bagian)),
			bagian,
		);
});

test("bagian kosong dianggap hilang", () => {
	const r = parseBrief(brief({ TUJUAN: "   " }));
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.ok(r.errors.some((e) => e.includes("TUJUAN")));
});

test("label ganda dan teks sebelum label pertama ditolak", () => {
	const ganda = parseBrief(`${brief()}\nTUJUAN: lagi`);
	assert.equal(ganda.ok, false);
	if (!ganda.ok)
		assert.ok(ganda.errors.some((e) => /TUJUAN.*dua kali|ganda/.test(e)));
	const depan = parseBrief(`halo dulu\n${brief()}`);
	assert.equal(depan.ok, false);
	if (!depan.ok) assert.ok(depan.errors.some((e) => /sebelum/.test(e)));
});

test("LANGKAH harus bernomor; baris lanjutan menyambung langkah sebelumnya", () => {
	const tanpaNomor = parseBrief(brief({ LANGKAH: "buka lalu ubah" }));
	assert.equal(tanpaNomor.ok, false);
	if (!tanpaNomor.ok)
		assert.ok(tanpaNomor.errors.some((e) => e.includes("LANGKAH")));

	const sambung = parseBrief(
		brief({
			LANGKAH: "1. Buka halaman\n   yang di port 3000.\n2) Ubah kolom.",
		}),
	);
	assert.equal(sambung.ok, true);
	if (sambung.ok)
		assert.deepEqual(sambung.brief.langkah, [
			"Buka halaman yang di port 3000.",
			"Ubah kolom.",
		]);
});

test("CAKUPAN: edit tanpa path, mode tidak dikenal, dan path berbahaya ditolak", () => {
	for (const cakupan of [
		"edit",
		"hapus semua",
		"baca src/a.ts",
		"edit /etc/passwd",
		"edit ../luar/a.ts",
		"edit src/../../a.ts",
		"edit -rf",
	]) {
		const r = parseBrief(brief({ CAKUPAN: cakupan }));
		assert.equal(r.ok, false, cakupan);
		if (r.ok) return;
		assert.ok(
			r.errors.some((e) => e.includes("CAKUPAN")),
			cakupan,
		);
	}
});

test("tugas edit wajib punya minimal satu perintah CEK", () => {
	for (const cek of ["-", "tidak ada"]) {
		const r = parseBrief(brief({ CEK: cek }));
		assert.equal(r.ok, false, cek);
		if (r.ok) return;
		assert.ok(r.errors.some((e) => e.includes("CEK") && e.includes("edit")));
	}
});

test("akhir baris CRLF dan awalan ./ pada path ditangani", () => {
	const r = parseBrief(
		brief({ CAKUPAN: "edit ./src/a.ts" }).replace(/\n/g, "\r\n"),
	);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	assert.deepEqual(r.brief.cakupan, { mode: "edit", paths: ["src/a.ts"] });
});
