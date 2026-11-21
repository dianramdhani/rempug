import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Ledger } from "../../src/core/ledger.js";
import { jawab, paham, tunggu } from "../../src/core/paham.js";
import { registerAgent } from "../../src/core/registry.js";
import type { Transport } from "../../src/core/transport.js";
import { tmp } from "../helpers.js";

const BRIEF = `TUJUAN: Ubah kolom
CAKUPAN: edit src/features/device/**
LANGKAH:
1. Ubah.
CEK:
yarn tsc -b
yarn check
BALASAN: hasil`;

const PAHAM = (over: Partial<Record<string, string>> = {}) => {
	const isi: Record<string, string> = {
		CAKUPAN: "edit src/features/device/**",
		CEK: "yarn tsc -b\nyarn check",
		RENCANA:
			"1. Buka src/features/device/index.tsx\n2. Ubah kolom\n3. Jalankan cek",
		ASUMSI: "-",
		PERTANYAAN: "-",
		...over,
	};
	return Object.entries(isi)
		.map(([k, v]) => (v.includes("\n") ? `${k}:\n${v}` : `${k}: ${v}`))
		.join("\n");
};

function siapkan(
	t: Parameters<typeof tmp>[0],
	opsi: { brief?: string; teliti?: boolean } = {},
) {
	const ledger = Ledger.open(join(tmp(t), "l.db"));
	t.after(() => ledger.close());
	const brief = opsi.brief ?? BRIEF;
	const baca = brief.includes("CAKUPAN: baca");
	const id = ledger.createTask({
		repo: "/r",
		agent: "codex",
		mode: baca ? "baca" : "edit",
		scope: baca ? undefined : ["src/features/device/**"],
		brief,
		teliti: opsi.teliti,
	});
	ledger.setStatus(id, "berjalan");
	return { ledger, id };
}

test("pemahaman cocok: LANJUT tanpa event dan status tetap berjalan", (t) => {
	const { ledger, id } = siapkan(t);
	assert.deepEqual(paham(ledger, id, PAHAM()), { hasil: "LANJUT" });
	assert.equal(ledger.getTask(id)?.status, "berjalan");
	assert.equal(ledger.getTask(id)?.paham, PAHAM());
	assert.deepEqual(ledger.eventsAfter(0, "/r"), []);
});

test("CAKUPAN tanpa kata edit, urutan beda, atau awalan ./ tetap dianggap sama", (t) => {
	const { ledger, id } = siapkan(t);
	assert.equal(
		paham(ledger, id, PAHAM({ CAKUPAN: "./src/features/device/**" })).hasil,
		"LANJUT",
	);
	assert.equal(
		paham(ledger, id, PAHAM({ CEK: "yarn check\nyarn tsc -b" })).hasil,
		"LANJUT",
	);
});

test("tugas baca disetujui otomatis tanpa RENCANA", (t) => {
	const { ledger, id } = siapkan(t, {
		brief:
			"TUJUAN: Cek\nCAKUPAN: baca\nLANGKAH:\n1. Lihat.\nCEK: -\nBALASAN: hasil",
	});
	assert.deepEqual(paham(ledger, id, "apa saja"), { hasil: "LANJUT" });
});

const KASUS: [string, Partial<Record<string, string>>, RegExp][] = [
	["cakupan berbeda", { CAKUPAN: "edit src/features/**" }, /cakupan berbeda/],
	["cek berbeda", { CEK: "yarn tsc -b" }, /cek berbeda/],
	[
		"rencana lebih dari 3 butir",
		{ RENCANA: "1. a\n2. b\n3. c\n4. d" },
		/lebih dari 3/,
	],
	[
		"rencana menyentuh di luar cakupan",
		{ RENCANA: "1. Ubah package.json dan src/lib/x.ts" },
		/di luar cakupan.*package\.json/,
	],
	[
		"tindakan terlarang git push",
		{ RENCANA: "1. Ubah lalu git push" },
		/terlarang.*git push/,
	],
	["tindakan terlarang rm -rf", { RENCANA: "1. rm -rf dist" }, /terlarang/],
	[
		"asumsi terisi",
		{ ASUMSI: "kolom status dianggap opsional" },
		/asumsi: kolom status/,
	],
	[
		"pertanyaan terisi",
		{ PERTANYAAN: "apakah urutan kolom penting?" },
		/pertanyaan: apakah urutan/,
	],
];

for (const [nama, over, pola] of KASUS) {
	test(`menahan tugas: ${nama}`, (t) => {
		const { ledger, id } = siapkan(t);
		const hasil = paham(ledger, id, PAHAM(over));
		assert.equal(hasil.hasil, "MENUNGGU");
		if (hasil.hasil !== "MENUNGGU") return;
		assert.match(hasil.alasan, pola);
		assert.equal(ledger.getTask(id)?.status, "menunggu-klarifikasi");
		const event = ledger.eventsAfter(0, "/r");
		assert.equal(event.length, 1);
		assert.match(
			event[0]?.line ?? "",
			new RegExp(`^T${id} codex menunggu-klarifikasi: `),
		);
		assert.equal(event[0]?.line.includes("\n"), false);
	});
}

test("format salah ditolak dengan UsageError dan tidak mengubah status", (t) => {
	const { ledger, id } = siapkan(t);
	assert.throws(
		() => paham(ledger, id, "CAKUPAN: edit src/**\nCEK: x"),
		(e: Error) =>
			e.name === "UsageError" &&
			/RENCANA/.test(e.message) &&
			/ASUMSI/.test(e.message),
	);
	assert.equal(ledger.getTask(id)?.status, "berjalan");
	assert.equal(ledger.getTask(id)?.putaran, 0);
});

test("--teliti tidak menyetujui otomatis dan menyertakan rencana ringkas di event", (t) => {
	const { ledger, id } = siapkan(t, { teliti: true });
	const hasil = paham(ledger, id, PAHAM());
	assert.equal(hasil.hasil, "MENUNGGU");
	const line = ledger.eventsAfter(0, "/r")[0]?.line ?? "";
	assert.match(line, /teliti/);
	assert.match(
		line,
		/Buka src\/features\/device\/index\.tsx \/ Ubah kolom \/ Jalankan cek/,
	);
});

test("putaran klarifikasi dibatasi 3, lalu gagal-paham", (t) => {
	const { ledger, id } = siapkan(t);
	for (let i = 1; i <= 3; i++) {
		assert.equal(
			paham(ledger, id, PAHAM({ PERTANYAAN: `q${i}` })).hasil,
			"MENUNGGU",
		);
		assert.equal(ledger.getTask(id)?.putaran, i);
		ledger.setStatus(id, "berjalan");
	}
	assert.deepEqual(paham(ledger, id, PAHAM({ PERTANYAAN: "q4" })), {
		hasil: "GAGAL-PAHAM",
	});
	assert.equal(ledger.getTask(id)?.status, "gagal-paham");
	assert.match(ledger.eventsAfter(0, "/r").at(-1)?.line ?? "", /gagal-paham/);
});

test("tunggu: BELUM saat belum ada jawaban, lalu JAWABAN dan LANJUT setelah jawab", async (t) => {
	const { ledger, id } = siapkan(t);
	paham(ledger, id, PAHAM({ PERTANYAAN: "q?" }));
	const cepat = { timeoutMs: 80, pollMs: 10 };
	assert.match(await tunggu(ledger, id, cepat), /^BELUM/);
	assert.equal(ledger.getTask(id)?.status, "menunggu-klarifikasi");

	await jawab(
		{ ledger, registryFile: "", transport: {} as Transport },
		id,
		"urutan tidak penting",
	);
	assert.equal(
		await tunggu(ledger, id, cepat),
		"JAWABAN: urutan tidak penting\nLANJUT",
	);
	assert.equal(ledger.getTask(id)?.status, "berjalan");
	assert.equal(ledger.getTask(id)?.jawaban, undefined);
	assert.equal(await tunggu(ledger, id, cepat), "LANJUT");
});

test("tunggu melaporkan gagal-paham dan status lain", async (t) => {
	const a = siapkan(t);
	a.ledger.setStatus(a.id, "gagal-paham");
	assert.match(
		await tunggu(a.ledger, a.id, { timeoutMs: 50, pollMs: 10 }),
		/^GAGAL-PAHAM/,
	);
	const b = siapkan(t);
	b.ledger.setStatus(b.id, "selesai");
	assert.match(
		await tunggu(b.ledger, b.id, { timeoutMs: 50, pollMs: 10 }),
		/^STOP.*selesai/,
	);
	await assert.rejects(
		tunggu(b.ledger, 999, { timeoutMs: 50, pollMs: 10 }),
		/T999/,
	);
});

test("jawab pada tugas yang berjalan menyuntikkan teks ke agent lewat profilnya", async (t) => {
	const { ledger, id } = siapkan(t);
	const registryFile = join(tmp(t), "registry.json");
	registerAgent(registryFile, {
		name: "codex",
		kind: "codex",
		tmux: "2:0.0",
		capabilities: [],
	});
	const terkirim: [string, string][] = [];
	const transport = {
		kirim: async (target: string, baris: string) =>
			void terkirim.push([target, baris]),
	} as unknown as Transport;
	assert.equal(
		await jawab({ ledger, registryFile, transport }, id, "pakai opsi B"),
		"dikirim",
	);
	assert.deepEqual(terkirim, [["2:0.0", "pakai opsi B"]]);

	ledger.setStatus(id, "selesai");
	await assert.rejects(
		jawab({ ledger, registryFile, transport }, id, "x"),
		/selesai/,
	);
	await assert.rejects(
		jawab({ ledger, registryFile, transport }, 999, "x"),
		/T999/,
	);
});
