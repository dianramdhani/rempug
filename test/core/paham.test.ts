import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Ledger } from "../../src/core/ledger.js";
import { jawab, paham, tunggu } from "../../src/core/paham.js";
import { registerAgent } from "../../src/core/registry.js";
import type { Transport } from "../../src/core/transport.js";
import { gitRepo, tmp } from "../helpers.js";

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

/** Tugas edit pada repo sungguhan (agar pemeriksaan "path ada di disk" bekerja), cakupan satu berkas laporan. */
function siapkanAudit(t: Parameters<typeof tmp>[0]) {
	const repo = tmp(t);
	for (const d of [
		"src/features/sdwan",
		"src/features/chatbot",
		"docs",
		"laporan",
	])
		mkdirSync(join(repo, d), { recursive: true });
	writeFileSync(join(repo, "AGENTS.md"), "aturan\n");
	writeFileSync(join(repo, "rule-checklist.md"), "aturan\n");
	const ledger = Ledger.open(join(tmp(t), "l.db"));
	t.after(() => ledger.close());
	const brief = `TUJUAN: Audit kepatuhan\nCAKUPAN: edit evidence/AUDIT-A1.md\nLANGKAH:\n1. Baca lalu tulis laporan.\nCEK:\ntest -s evidence/AUDIT-A1.md\ngit diff --check\nBALASAN: hasil`;
	const id = ledger.createTask({
		repo,
		agent: "agy",
		mode: "edit",
		scope: ["evidence/AUDIT-A1.md"],
		brief,
	});
	ledger.setStatus(id, "berjalan");
	const kirim = (over: Partial<Record<string, string>>) =>
		paham(
			ledger,
			id,
			Object.entries({
				CAKUPAN: "edit evidence/AUDIT-A1.md",
				CEK: "test -s evidence/AUDIT-A1.md\ngit diff --check",
				RENCANA: "1. Baca AGENTS.md",
				ASUMSI: "-",
				PERTANYAAN: "-",
				...over,
			})
				.map(([k, v]) =>
					String(v).includes("\n") ? `${k}:\n${v}` : `${k}: ${v}`,
				)
				.join("\n"),
		);
	return { kirim, ledger, id };
}

test("berkas di luar cakupan yang hanya DIBACA tidak menahan tugas", (t) => {
	const { kirim } = siapkanAudit(t);
	const kasus = [
		"1. Baca rule-checklist.md dan AGENTS.md (hanya baca)\n2. Periksa src/features/sdwan dan src/features/chatbot dengan rg\n3. Tulis laporan ke evidence/AUDIT-A1.md",
		"1) Baca checklist dan aturan AGENTS.md read-only 2) Periksa folder fitur dengan rg; tulis laporan hanya pada berkas cakupan 3) Jalankan cek",
		// Teks rencana asli codex dari sesi audit nyata (ditolak tiga kali oleh versi 0.1.1).
		"1) Baca checklist dan aturan AGENTS.md yang dirujuk secara read-only. 2) Periksa enam folder fitur dengan rg dan telaah konteks; tulis laporan/checkpoint hanya pada berkas cakupan. 3) Jalankan cek laporan dan laporkan hasil.",
		// Teks rencana asli agy dari sesi yang sama; pola {a,b} dibaca sebagai dua path.
		"1. Menghitung berkas dan menjalankan pola rg untuk 20 aturan pada src/features/{sdwan,chatbot,error}.\n2. Memeriksa konteks tiap kandidat (membedakan false positive dan aturan kelas JUDGMENT AR-05, AR-08, AR-24).\n3. Menulis laporan triase ke evidence/AUDIT-A1.md beserta checkpoint per aturan lalu menjalankan cek.",
		"1. Menghitung berkas dan menjalankan pola rg pada src/features/{sdwan,chatbot}\n2. Memeriksa konteks tiap kandidat\n3. Menulis laporan ke evidence/AUDIT-A1.md",
	];
	for (const rencana of kasus)
		assert.deepEqual(kirim({ RENCANA: rencana }), { hasil: "LANJUT" }, rencana);
});

test("berkas di luar cakupan yang DITULIS tetap menahan tugas, termasuk lewat {a,b}", (t) => {
	const { kirim } = siapkanAudit(t);
	const a = kirim({ RENCANA: "1. Ubah AGENTS.md agar lebih singkat" });
	assert.equal(a.hasil, "MENUNGGU");
	if (a.hasil === "MENUNGGU")
		assert.match(a.alasan, /di luar cakupan.*AGENTS\.md/);

	const { kirim: k2 } = siapkanAudit(t);
	const b = k2({ RENCANA: "1. Hapus src/features/{sdwan,chatbot}/old.ts" });
	assert.equal(b.hasil, "MENUNGGU");
	if (b.hasil === "MENUNGGU")
		assert.match(
			b.alasan,
			/src\/features\/sdwan\/old\.ts, src\/features\/chatbot\/old\.ts/,
		);
});

test("kata kerja menulis pada butir lain tidak ikut menandai path yang disebut di butir baca", (t) => {
	const { kirim } = siapkanAudit(t);
	const r = kirim({
		RENCANA: "1. Baca AGENTS.md\n2. Tulis temuan ke evidence/AUDIT-A1.md",
	});
	assert.deepEqual(r, { hasil: "LANJUT" });
});

test("kata biasa (laporan/checkpoint, docs) bukan path, tetapi path yang ada di disk tanpa ekstensi tetap dikenali", (t) => {
	const { kirim } = siapkanAudit(t);
	assert.deepEqual(
		kirim({ RENCANA: "1. Tulis laporan/checkpoint pada berkas cakupan" }),
		{ hasil: "LANJUT" },
	);
	// Kata polos tanpa garis miring ("docs") tidak dihitung; terlalu sering sama dengan kata biasa.
	assert.deepEqual(kirim({ RENCANA: "1. Hapus docs lalu tulis laporan" }), {
		hasil: "LANJUT",
	});
	// Tetapi path yang ada di disk dikenali walau tanpa ekstensi.
	const r = kirim({ RENCANA: "1. Hapus docs/ lalu tulis laporan" });
	assert.equal(r.hasil, "MENUNGGU");
});

test("tindakan terlarang tetap ditandai di butir mana pun, juga yang hanya membaca", (t) => {
	const { kirim } = siapkanAudit(t);
	const r = kirim({ RENCANA: "1. Baca AGENTS.md lalu git push hasilnya" });
	assert.equal(r.hasil, "MENUNGGU");
	if (r.hasil === "MENUNGGU") assert.match(r.alasan, /terlarang.*git push/);
});

test("CEK: perintah brief boleh digabung &&, memakai tanda kutip, bullet, atau prompt", (t) => {
	const variasi = [
		"test -s evidence/AUDIT-A1.md && git diff --check",
		"`test -s evidence/AUDIT-A1.md`\n`git diff --check`",
		"- test -s evidence/AUDIT-A1.md\n- git diff --check",
		"$ test -s   evidence/AUDIT-A1.md\n$ git diff --check",
		"1. test -s evidence/AUDIT-A1.md\n2. git diff --check",
		"git diff --check\ntest -s evidence/AUDIT-A1.md",
	];
	for (const cek of variasi) {
		const { kirim } = siapkanAudit(t);
		assert.deepEqual(kirim({ CEK: cek }), { hasil: "LANJUT" }, cek);
	}
});

test("CEK: perintah tambahan dari agent boleh, tetapi perintah brief yang hilang menahan tugas dan disebut", (t) => {
	const { kirim } = siapkanAudit(t);
	assert.deepEqual(
		kirim({
			CEK: "test -s evidence/AUDIT-A1.md\ngit diff --check\nwc -l evidence/AUDIT-A1.md",
		}),
		{ hasil: "LANJUT" },
	);

	const { kirim: k2 } = siapkanAudit(t);
	const r = k2({ CEK: "test -s evidence/AUDIT-A1.md" });
	assert.equal(r.hasil, "MENUNGGU");
	if (r.hasil === "MENUNGGU")
		assert.match(
			r.alasan,
			/cek berbeda dari brief.*tidak disebut: git diff --check/,
		);

	const { kirim: k3 } = siapkanAudit(t);
	assert.equal(k3({ CEK: "-" }).hasil, "MENUNGGU");
});

/** Repo git sungguhan berisi berkas yang disebut agent dengan nama pendek, seperti di sesi audit nyata. */
function siapkanNamaPendek(t: Parameters<typeof tmp>[0]) {
	const repo = gitRepo(t, {
		"src/features/sim/components/drawer-form-sim/index.tsx": "a\n",
		"src/features/sim/components/drawer-form-sim/spec.md": "b\n",
		"src/features/sim/components/lain/index.tsx": "c\n",
		"package.json": "{}\n",
	});
	const ledger = Ledger.open(join(tmp(t), "l.db"));
	t.after(() => ledger.close());
	const scope = [
		"src/features/sim/components/drawer-form-sim/index.tsx",
		"src/features/sim/components/drawer-form-sim/spec.md",
	];
	const brief = `TUJUAN: Teruskan loading\nCAKUPAN: edit ${scope.join(" ")}\nLANGKAH:\n1. Ubah.\nCEK:\ntrue\nBALASAN: hasil`;
	const id = ledger.createTask({
		repo,
		agent: "agy",
		mode: "edit",
		scope,
		brief,
	});
	ledger.setStatus(id, "berjalan");
	return (rencana: string) =>
		paham(
			ledger,
			id,
			`CAKUPAN: edit ${scope.join(" ")}\nCEK: true\nRENCANA: ${rencana}\nASUMSI: -\nPERTANYAAN: -`,
		);
}

test("nama berkas pendek atau parsial yang ada di cakupan dianggap berada di cakupan", (t) => {
	const kirim = siapkanNamaPendek(t);
	for (const rencana of [
		"1. Ubah drawer-form-sim/index.tsx dan spec.md",
		"1. Ubah index.tsx lalu perbarui spec.md",
		"1. Edit src/features/sim/components/drawer-form-sim/spec.md",
	])
		assert.deepEqual(kirim(rencana), { hasil: "LANJUT" }, rencana);
});

test("nama berkas pendek yang TIDAK ada di cakupan tetap menahan tugas", (t) => {
	const kirim = siapkanNamaPendek(t);
	const r = kirim("1. Ubah package.json");
	assert.equal(r.hasil, "MENUNGGU");
	if (r.hasil === "MENUNGGU")
		assert.match(r.alasan, /di luar cakupan.*package\.json/);
	assert.equal(kirim("1. Ubah lain/index.tsx").hasil, "MENUNGGU");
});

test("tanda garis miring tunggal bukan path", (t) => {
	const { kirim } = siapkanAudit(t);
	assert.deepEqual(
		kirim({ RENCANA: "1. Tulis laporan ke evidence/AUDIT-A1.md / lalu cek /" }),
		{ hasil: "LANJUT" },
	);
	assert.deepEqual(
		kirim({ RENCANA: "1. Baca dan/atau tulis temuan ke evidence/AUDIT-A1.md" }),
		{ hasil: "LANJUT" },
	);
});
