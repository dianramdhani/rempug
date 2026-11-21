import assert from "node:assert/strict";
import { test } from "node:test";
import type { Task } from "../../src/core/ledger.js";
import {
	barisLog,
	formatLaporan,
	formatLaporanManusia,
	formatLaporanMd,
	formatShow,
} from "../../src/core/report.js";

const dasar: Task = {
	id: 1,
	repo: "/r",
	agent: "codex",
	mode: "edit",
	scope: ["src/**"],
	status: "selesai",
	afterId: undefined,
	brief: "TUJUAN: x",
	headSha: undefined,
	branch: undefined,
	sentAt: 0,
	repliedAt: undefined,
	replySummary: undefined,
	replyDetail: undefined,
	ackedAt: undefined,
	verify: undefined,
	teliti: false,
	centang: undefined,
	paham: undefined,
	jawaban: undefined,
	putaran: 0,
	porcelain: undefined,
	scrHash: undefined,
	scrSince: undefined,
	flag: undefined,
	upaya: 0,
	pengingat: 0,
};
const tugas = (over: Partial<Task>): Task => ({ ...dasar, ...over });
const verify = (linha: string, extra: object = {}) =>
	JSON.stringify({
		linha,
		perubahan: [{ path: "src/a.ts", status: "M", plus: 3, minus: 1 }],
		cek: [],
		...extra,
	});

test("barisLog memakai baris verifikasi bila ada", () => {
	assert.equal(
		barisLog(tugas({ verify: verify("T1 codex ✓ 1 file +3/−1 | scope OK") })),
		"T1 codex ✓ 1 file +3/−1 | scope OK",
	);
});

test("barisLog tanpa verifikasi: status, alasan gagal, dan penanda pemantau", () => {
	assert.equal(barisLog(tugas({ status: "antri" })), "T1 codex antri");
	assert.equal(
		barisLog(tugas({ status: "gagal", replySummary: "limit habis\nlain" })),
		"T1 codex ✗ gagal: limit habis",
	);
	assert.equal(
		barisLog(tugas({ status: "berjalan", flag: "bertanya" })),
		"T1 codex berjalan (bertanya)",
	);
	assert.equal(
		barisLog(tugas({ status: "berjalan", ackedAt: 5 })),
		"T1 codex berjalan",
	);
});

test("formatShow ringkas: baris, ringkasan; penuh: brief, balasan lengkap, perubahan, dan ekor cek yang gagal", () => {
	const t = tugas({
		verify: verify("T1 codex ✗ 1 file +3/−1 | scope OK | tsc ✗(2)", {
			cek: [
				{ label: "tsc", ok: false, ekor: "error TS1\nerror TS2" },
				{ label: "biome", ok: true, ekor: "" },
			],
		}),
		replySummary: "hasil A\nbukti B",
		replyDetail: "hasil A\nbukti B\nrinci panjang",
	});
	const ringkas = formatShow(t, false);
	assert.match(ringkas, /^T1 codex selesai \(edit\)/);
	assert.match(ringkas, /T1 codex ✗ 1 file/);
	assert.match(ringkas, /ringkasan:\n {2}hasil A\n {2}bukti B/);
	assert.doesNotMatch(ringkas, /rinci panjang/);

	const penuh = formatShow(t, true);
	assert.match(penuh, /brief:\n {2}TUJUAN: x/);
	assert.match(
		penuh,
		/balasan lengkap:\n {2}hasil A\n {2}bukti B\n {2}rinci panjang/,
	);
	assert.match(penuh, /perubahan:\n {2}M src\/a\.ts \+3\/−1/);
	assert.match(penuh, /cek gagal tsc:\n {2}error TS1\n {2}error TS2/);
	assert.doesNotMatch(penuh, /biome:/);
});

test("formatLaporan mengelompokkan tugas dan memisahkan blocker", () => {
	const teks = formatLaporan("/r", [
		tugas({ id: 1, verify: verify("T1 codex ✓ ok") }),
		tugas({ id: 2, agent: "agy", status: "berjalan" }),
		tugas({ id: 3, status: "gagal", replySummary: "salah" }),
		tugas({ id: 4, status: "macet" }),
		tugas({ id: 5, agent: "agy", status: "berjalan", flag: "menunggu-izin" }),
	]);
	assert.match(teks, /^laporan rempug \/r$/m);
	assert.match(teks, /selesai \(1\)\n {2}T1 codex ✓ ok/);
	assert.match(teks, /berjalan \(2\)/);
	assert.match(teks, /gagal \(1\)\n {2}T3 codex ✗ gagal: salah/);
	assert.match(teks, /blocker \(2\)/);
	assert.match(teks, /T4 codex macet/);
	assert.match(teks, /T5 agy berjalan \(menunggu-izin\)/);
});

test("formatLaporan membatasi daftar panjang dan menyebut sisanya", () => {
	const banyak = Array.from({ length: 14 }, (_, i) =>
		tugas({ id: i + 1, verify: verify(`T${i + 1} ok`) }),
	);
	const teks = formatLaporan("/r", banyak);
	assert.match(teks, /selesai \(14\)/);
	assert.match(teks, /\+4 lagi/);
	assert.equal((teks.match(/^ {2}T\d+ ok$/gm) ?? []).length, 10);
});

test("formatLaporan tanpa tugas", () => {
	assert.match(formatLaporan("/r", []), /belum ada tugas/);
});

test("formatLaporanMd menghasilkan Markdown dengan judul dan daftar", () => {
	const md = formatLaporanMd("/r", [
		tugas({ id: 1, verify: verify("T1 codex ✓ ok") }),
	]);
	assert.match(md, /^# Laporan rempug/);
	assert.match(md, /## Selesai \(1\)\n\n- T1 codex ✓ ok/);
});

const TERLARANG =
	/\bT\d+\b|[✓✗⚠⏱−→]|--|\bCEK\b|\bscope\b|\bwatch\b|\bantrean\b|\bterima\b|\back\b/;
// Tanpa flag i: label internal CEK ditulis kapital, sedangkan "Cek" adalah kata biasa dalam judul tugas.
const brief = (tujuan: string, cakupan = "baca") =>
	`TUJUAN: ${tujuan}\nCAKUPAN: ${cakupan}\nLANGKAH:\n1. a\nCEK: ${cakupan.startsWith("edit") ? "true" : "-"}\nBALASAN: b`;

test("laporan untuk manusia: kalimat biasa, tanpa ID tugas, simbol, atau istilah internal", () => {
	const tasks = [
		tugas({
			id: 12,
			agent: "codex",
			brief: brief("Ubah kolom tabel Devices", "edit src/**"),
			verify: verify("T12 codex ✓ 3 file +41/−7 | scope OK | tsc ✓", {
				perubahan: [
					{ path: "src/a.ts", status: "M", plus: 30, minus: 5 },
					{ path: "src/b.ts", status: "A", plus: 11, minus: 2 },
					{ path: "src/c.ts", status: "D", plus: 0, minus: 0 },
				],
				plus: 41,
				minus: 7,
				luarCakupan: [],
				cek: [{ label: "tsc", ok: true, ekor: "" }],
			}),
		}),
		tugas({
			id: 13,
			agent: "agy",
			mode: "browser",
			brief: brief("Periksa halaman Devices lewat browser", "browser"),
			verify: verify("T13 agy ✓ browser | ok", { perubahan: [], cek: [] }),
			replySummary:
				"HASIL: halaman terbuka dengan 922 device\\nBUKTI: ...".replace(
					"\\n",
					"\n",
				),
		}),
		tugas({
			id: 14,
			agent: "codex",
			status: "gagal",
			brief: brief("Rapikan impor", "edit lib/**"),
			verify: verify("T14 codex ✗ | tsc ✗(2)", {
				perubahan: [],
				cek: [{ label: "tsc", ok: false, gagal: 2, ekor: "error" }],
			}),
		}),
		tugas({
			id: 15,
			agent: "agy",
			status: "berjalan",
			mode: "browser",
			brief: brief("Bandingkan dua halaman"),
		}),
		tugas({
			id: 16,
			agent: "agy",
			status: "berjalan",
			flag: "menunggu-izin",
			mode: "browser",
			brief: brief("Buka laporan bulanan"),
		}),
		tugas({
			id: 17,
			agent: "codex",
			status: "pelanggaran",
			brief: brief("Ubah tema", "edit src/**"),
			verify: verify(
				"T17 codex ⚠ pelanggaran: HEAD berubah (aaaaaaa→bbbbbbb)",
				{
					pelanggaran: "HEAD berubah (aaaaaaa→bbbbbbb)",
					perubahan: [],
					cek: [],
				},
			),
		}),
		tugas({
			id: 18,
			agent: "agy",
			status: "macet",
			mode: "browser",
			brief: brief("Cek notifikasi"),
		}),
	];
	const teks = formatLaporanManusia(tasks);
	assert.doesNotMatch(teks, TERLARANG, teks);
	assert.match(teks, /Ubah kolom tabel Devices/);
	assert.match(
		teks,
		/mengubah 1 berkas, menambah 1 berkas baru, dan menghapus 1 berkas/,
	);
	assert.match(teks, /41 baris ditambah, 7 dihapus/);
	assert.match(teks, /halaman terbuka dengan 922 device/);
	assert.match(teks, /pengecekan tsc gagal \(2 masalah\)/);
	assert.match(teks, /sedang dikerjakan/);
	assert.match(teks, /menunggu persetujuan Anda di sesi agy/);
	assert.match(teks, /mengubah riwayat git tanpa izin/);
	assert.match(teks, /terhenti dan tidak merespons/);
	assert.match(teks, /^Selesai/m);
	assert.match(teks, /^Sedang berjalan/m);
	assert.match(teks, /^Perlu perhatian/m);
});

test("laporan manusia: perubahan di luar area tugas disebut dengan nama berkas, tanpa istilah teknis", () => {
	const teks = formatLaporanManusia([
		tugas({
			brief: brief("Ubah kolom", "edit src/**"),
			verify: verify("x", {
				perubahan: [{ path: "src/a.ts", status: "M", plus: 1, minus: 0 }],
				plus: 1,
				minus: 0,
				luarCakupan: ["lib/c.ts", "docs/x.md"],
				cek: [],
			}),
		}),
	]);
	assert.doesNotMatch(teks, TERLARANG, teks);
	assert.match(
		teks,
		/juga ada perubahan di luar area tugas: lib\/c\.ts, docs\/x\.md/,
	);
});

test("laporan manusia: tanpa tugas dan ringkasan balasan yang panjang dipotong", () => {
	assert.equal(
		formatLaporanManusia([]),
		"Belum ada pekerjaan yang didelegasikan.",
	);
	const panjang = formatLaporanManusia([
		tugas({
			mode: "browser",
			brief: brief("Cek halaman", "browser"),
			verify: verify("x", { perubahan: [], cek: [] }),
			replySummary: `HASIL: ${"kata ".repeat(80)}`,
		}),
	]);
	assert.ok(
		panjang.split("\n").every((l) => l.length < 220),
		panjang,
	);
	assert.match(panjang, /…/);
});

test("laporan manusia: brief yang tidak lolos validasi tetap menampilkan judulnya", () => {
	const teks = formatLaporanManusia([
		tugas({
			mode: "browser",
			status: "berjalan",
			brief: "TUJUAN: Cek halaman login\nsisa brief rusak",
		}),
	]);
	assert.match(teks, /Cek halaman login \(oleh codex\): sedang dikerjakan/);
});

test("laporan manusia: commit lain saat tugas berjalan disebut sebagai catatan, bukan kegagalan", () => {
	const teks = formatLaporanManusia([
		tugas({
			brief: brief("Audit fitur laporan", "edit evidence/A.md"),
			verify: verify("x", {
				perubahan: [{ path: "evidence/A.md", status: "A", plus: 70, minus: 0 }],
				plus: 70,
				minus: 0,
				luarCakupan: [],
				cek: [],
				peringatan:
					"HEAD maju 2 commit selama tugas, di luar cakupan tugas ini",
			}),
		}),
	]);
	assert.doesNotMatch(teks, TERLARANG, teks);
	assert.match(teks, /^Selesai/m);
	assert.match(
		teks,
		/juga ada commit lain di repo selama tugas berjalan \(bukan dari tugas ini\)/,
	);
	assert.doesNotMatch(teks, /Perlu perhatian/);
});
