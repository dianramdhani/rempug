import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	KANDIDAT,
	PROFIL_BAWAAN,
	type Profil,
} from "../../src/core/profile.js";
import { tmuxTransport } from "../../src/core/transport.js";
import { startTmux, tmp, until } from "../helpers.js";

async function agen(t: Parameters<typeof tmp>[0], mode: string) {
	const dir = tmp(t);
	const out = join(dir, "diterima.log");
	const tmux = startTmux(t);
	tmux.newFakeAgent("1", dir, [mode, out]);
	const transport = tmuxTransport(tmux.opts);
	await until(() =>
		transport.layar("1:0.0").includes(`fake-agent ${mode}`) ? true : undefined,
	);
	const diterima = () =>
		existsSync(out) ? readFileSync(out, "utf8").trim().split("\n") : [];
	return { transport, diterima };
}

const tunggu = (ms: number) => new Promise((r) => setTimeout(r, ms));
const POINTER =
	'Tugas T1: jalankan `rempug brief T1` $HOME "x" ; (ok) & selesai';

test("profil bawaan: ketikan biasa lalu Enter sampai utuh, termasuk karakter shell", async (t) => {
	const { transport, diterima } = await agen(t, "normal");
	await transport.kirim("1:0.0", POINTER);
	await until(() => (diterima().length ? true : undefined));
	assert.deepEqual(diterima(), [POINTER]);
});

test("agent yang hanya menerima paste: profil keys gagal, profil paste berhasil", async (t) => {
	const { transport, diterima } = await agen(t, "paste");
	await transport.kirim("1:0.0", POINTER, PROFIL_BAWAAN);
	await tunggu(500);
	assert.deepEqual(diterima(), []);

	const paste: Profil = { ...PROFIL_BAWAAN, suntik: "paste" };
	await transport.kirim("1:0.0", POINTER, paste);
	await until(() => (diterima().length ? true : undefined));
	assert.deepEqual(diterima(), [POINTER]);
});

test("agent dengan sisa input dan Enter pertama ditelan: hanya profil yang cocok yang berhasil", async (t) => {
	// Tiap percobaan memakai agent baru, karena Enter pertama hanya ditelan sekali seumur agent.
	const coba = async (profil: Profil) => {
		const { transport, diterima } = await agen(t, "menu");
		await transport.kirim("1:0.0", POINTER, profil);
		await tunggu(500);
		return diterima();
	};
	assert.deepEqual(await coba(PROFIL_BAWAAN), []);
	assert.deepEqual(await coba({ ...PROFIL_BAWAAN, sebelum: ["C-u"] }), []);
	assert.deepEqual(
		await coba({
			...PROFIL_BAWAAN,
			sebelum: ["C-u"],
			submit: ["Enter", "Enter"],
		}),
		[POINTER],
	);
});

test("layar menampilkan teks yang tertahan di kotak input", async (t) => {
	const { transport } = await agen(t, "menu");
	await transport.kirim("1:0.0", "TOKEN-UNIK-123");
	const layar = await until(() => {
		const l = transport.layar("1:0.0");
		return l.includes("TOKEN-UNIK-123") ? l : undefined;
	});
	assert.match(layar, /> xTOKEN-UNIK-123/);
});

test("tekan mengirim tombol tanpa teks", async (t) => {
	const { transport } = await agen(t, "menu");
	await transport.tekan("1:0.0", ["C-u"]);
	await until(() =>
		/^>\s*$/m.test(transport.layar("1:0.0")) ? true : undefined,
	);
});

test("KANDIDAT dimulai dari profil bawaan dan berisi tiap bidang yang valid", () => {
	assert.deepEqual(KANDIDAT[0], PROFIL_BAWAAN);
	assert.ok(KANDIDAT.length >= 5);
	for (const k of KANDIDAT) {
		assert.ok(["keys", "paste"].includes(k.suntik));
		assert.ok(k.submit.length >= 1);
		assert.ok(k.jeda_ms > 0);
	}
	assert.equal(
		new Set(KANDIDAT.map((k) => JSON.stringify(k))).size,
		KANDIDAT.length,
	);
});
