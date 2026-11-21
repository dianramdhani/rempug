import assert from "node:assert/strict";
import { test } from "node:test";
import type { Task } from "../../src/core/ledger.js";
import {
	barisLog,
	formatLaporan,
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
