import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatProbe,
	isStale,
	probeAgent,
	reprobeJikaUsang,
	versiAgent,
} from "../../src/core/probe.js";
import { KANDIDAT, PROFIL_BAWAAN } from "../../src/core/profile.js";
import { readAgents } from "../../src/core/registry.js";
import { type SpesAgen, ujiAgen } from "../helpers.js";

// Jeda dipersingkat supaya uji cepat; urutan dan isi kandidat tetap sama.
const CEPAT = KANDIDAT.map((k) => ({ ...k, jeda_ms: 40 }));

async function siapkan(
	t: Parameters<typeof ujiAgen>[0],
	spes: Partial<SpesAgen>,
) {
	const h = await ujiAgen(t, [{ name: "agy", ...spes }]);
	const probe = (
		extra: { ackTimeoutMs?: number; kandidat?: typeof CEPAT } = {},
	) =>
		probeAgent(
			{
				ledger: h.ledger,
				registryFile: h.registryFile,
				transport: h.transport,
				tmux: h.tmux.opts,
				repo: "/repo",
				kandidat: CEPAT,
				ackTimeoutMs: 2500,
				baselineMs: 400,
				versi: () => "agy 1.5.13",
				...extra,
			},
			"agy",
		);
	return { ...h, probe, agen: () => readAgents(h.registryFile)[0] };
}

const ACK = { FAKE_ACK: "1" };

test("TUI biasa: profil bawaan lolos dan hasil ukur tersimpan di registry", async (t) => {
	const s = await siapkan(t, { env: ACK });
	const hasil = await s.probe();
	assert.equal(hasil.status, "siap");
	assert.equal(hasil.dicoba, 1);
	const agen = s.agen();
	assert.equal(agen?.tidakAndal, false);
	assert.equal(agen?.kirim?.suntik, PROFIL_BAWAAN.suntik);
	assert.deepEqual(agen?.kirim?.submit, PROFIL_BAWAAN.submit);
	assert.equal(agen?.versi, "agy 1.5.13");
	assert.ok((agen?.ukur?.ackMs ?? 0) > 0);
	assert.equal(agen?.ukur?.animasiIdle, false);
	assert.equal(agen?.ukur?.penandaSiap, ">");
	assert.equal(agen?.gagalBeruntun, 0);
	assert.equal(s.diterima("agy").length, 1);
});

test("TUI yang hanya menerima paste: profil paste ditemukan", async (t) => {
	const s = await siapkan(t, { mode: "paste", env: ACK });
	const hasil = await s.probe();
	assert.equal(hasil.status, "siap");
	assert.equal(s.agen()?.kirim?.suntik, "paste");
});

test("TUI dengan sisa input dan Enter pertama ditelan: probe tetap menemukan jalan, dengan beberapa percobaan", async (t) => {
	const s = await siapkan(t, { mode: "menu", env: ACK });
	const hasil = await s.probe();
	assert.equal(hasil.status, "siap");
	assert.ok(hasil.dicoba > 1);
	assert.equal(s.agen()?.tidakAndal, false);
	assert.ok(s.agen()?.kirim);
});

test("layar yang terus beranimasi saat idle ditandai animasiIdle", async (t) => {
	const s = await siapkan(t, { env: { ...ACK, FAKE_SPIN: "1" } });
	await s.probe();
	assert.equal(s.agen()?.ukur?.animasiIdle, true);
});

test("pointer diterima tetapi agent tidak menjalankan rempug: tanpa-ack, tidak dikirim ulang", async (t) => {
	const s = await siapkan(t, {});
	const hasil = await s.probe({ ackTimeoutMs: 700 });
	assert.equal(hasil.status, "tanpa-ack");
	assert.equal(hasil.dicoba, 1);
	assert.equal(s.agen()?.tidakAndal, true);
	assert.equal(s.diterima("agy").length, 1);
	assert.match(hasil.catatan ?? "", /tidak menjalankan rempug/);
});

test("teks tak pernah terkirim: semua kandidat dicoba, lalu tidak-andal dengan cuplikan layar", async (t) => {
	const s = await siapkan(t, { env: { FAKE_NOENTER: "1" } });
	const hasil = await s.probe({ ackTimeoutMs: 400 });
	assert.equal(hasil.status, "tidak-andal");
	assert.equal(hasil.dicoba, CEPAT.length);
	assert.match(hasil.catatan ?? "", /tertahan di kotak input/);
	assert.match(hasil.cuplikan ?? "", /fake-agent/);
	assert.equal(s.agen()?.tidakAndal, true);
	assert.equal(s.diterima("agy").length, 0);
});

test("agent yang menunggu izin: perlu-izin, bukan tidak-andal, dan tidak dijawab", async (t) => {
	const s = await siapkan(t, { env: { FAKE_AFTER: "izin" } });
	const hasil = await s.probe({ ackTimeoutMs: 700 });
	assert.equal(hasil.status, "perlu-izin");
	assert.equal(hasil.dicoba, 1);
	assert.notEqual(s.agen()?.tidakAndal, true);
	assert.match(hasil.catatan ?? "", /izin/);
	assert.equal(s.diterima("agy").length, 1);
});

test("tugas uji tidak meninggalkan jejak di ledger", async (t) => {
	const s = await siapkan(t, { env: ACK });
	await s.probe();
	assert.deepEqual(s.ledger.listTasks("/repo"), []);
	assert.deepEqual(s.ledger.eventsAfter(0, "/repo"), []);
});

test("isStale: versi berubah atau gagal berturut-turut dua kali", () => {
	const dasar = { name: "a", kind: "codex", tmux: "1:0.0", capabilities: [] };
	assert.equal(isStale({ ...dasar, versi: "1.0" }, "1.0"), false);
	assert.equal(isStale({ ...dasar, versi: "1.0" }, "1.1"), true);
	assert.equal(isStale({ ...dasar, versi: "1.0" }, undefined), false);
	assert.equal(isStale({ ...dasar }, "1.1"), false);
	assert.equal(isStale({ ...dasar, gagalBeruntun: 1 }, undefined), false);
	assert.equal(isStale({ ...dasar, gagalBeruntun: 2 }, undefined), true);
});

test("reprobeJikaUsang hanya memprobe ulang agent yang usang", async (t) => {
	const s = await siapkan(t, { env: ACK });
	await s.probe();
	const deps = {
		ledger: s.ledger,
		registryFile: s.registryFile,
		transport: s.transport,
		tmux: s.tmux.opts,
		repo: "/repo",
		kandidat: CEPAT,
		ackTimeoutMs: 2500,
		baselineMs: 300,
		versi: () => "agy 2.0",
	};
	assert.equal(await reprobeJikaUsang(deps, "agy", "agy 1.5.13"), undefined);
	assert.equal(s.diterima("agy").length, 1);

	const hasil = await reprobeJikaUsang(deps, "agy", "agy 2.0");
	assert.equal(hasil?.status, "siap");
	assert.equal(s.agen()?.versi, "agy 2.0");
	assert.equal(s.diterima("agy").length, 2);
});

test("versiAgent mengembalikan baris pertama --version, atau kosong bila tidak ada", () => {
	assert.match(versiAgent("node") ?? "", /^v\d+/);
	assert.equal(versiAgent("perintah-yang-tidak-ada-sama-sekali"), undefined);
});

test("formatProbe: satu baris untuk siap dan untuk yang gagal", () => {
	assert.equal(
		formatProbe({ nama: "agy", status: "siap", ackMs: 1840, dicoba: 1 }),
		"agy       ✓ siap  ack 1.8 dtk",
	);
	assert.equal(
		formatProbe({
			nama: "opencode",
			status: "tidak-andal",
			dicoba: 7,
			catatan: "teks tertahan di kotak input",
		}),
		"opencode  ✗ tidak-andal  teks tertahan di kotak input",
	);
	assert.equal(
		formatProbe({ nama: "x", status: "perlu-izin", dicoba: 1 }),
		"x         ✗ perlu-izin",
	);
});
