import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../src/commands.js";
import { UsageError } from "../src/core/errors.js";
import { KANDIDAT } from "../src/core/profile.js";
import { readAgents } from "../src/core/registry.js";
import { tmuxTransport } from "../src/core/transport.js";
import { gitRepo, startTmux, tmp, until, untilAsync } from "./helpers.js";

const pkg = JSON.parse(
	readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
	version: string;
};
const CEPAT = KANDIDAT.map((k) => ({ ...k, jeda_ms: 40 }));

const EDIT = (cek = "echo ok") =>
	`TUJUAN: Ubah kolom\nCAKUPAN: edit src/**\nLANGKAH:\n1. Ubah.\nCEK:\n${cek}\nBALASAN: hasil`;
const BACA =
	"TUJUAN: Cek\nCAKUPAN: baca\nLANGKAH:\n1. Lihat.\nCEK: -\nBALASAN: hasil";
const PAHAM = (rencana = "1. Ubah src/a.ts") =>
	`CAKUPAN: edit src/**\nCEK: echo ok\nRENCANA: ${rencana}\nASUMSI: -\nPERTANYAAN: -`;

interface Hasil {
	kode: number;
	out: string[];
	err: string[];
	teks: string;
}

async function siapkan(
	t: Parameters<typeof tmp>[0],
	agen: { nama: string; env?: Record<string, string> }[] = [],
) {
	const dir = tmp(t);
	const stateHome = join(dir, "state");
	const configHome = join(dir, "config");
	const env = {
		XDG_STATE_HOME: stateHome,
		XDG_CONFIG_HOME: configHome,
		HOME: dir,
	};
	const repo = gitRepo(t, {
		"src/a.ts": "satu\ndua\ntiga\n",
		"lib/c.ts": "cee\n",
		"spec/tasks.md": "- [ ] 1. Satu\n- [ ] 2. Dua\n",
	});
	const tmux = startTmux(t);
	const transport = tmuxTransport(tmux.opts);
	const log = (n: string) => join(dir, `${n}.log`);
	for (const [i, a] of agen.entries()) {
		const sesi = String(i + 1);
		tmux.newFakeAgent(sesi, repo, ["normal", log(a.nama)], {
			...env,
			...a.env,
		});
		await until(() =>
			transport.layar(`${sesi}:0.0`).includes("fake-agent") ? true : undefined,
		);
	}
	const verifikasi: number[] = [];
	const jalan = async (
		argv: string[],
		stdin?: string,
		tambahan: object = {},
	): Promise<Hasil> => {
		const out: string[] = [];
		const err: string[] = [];
		const kode = await run(argv, {
			env,
			cwd: repo,
			tmux: tmux.opts,
			transport,
			spawnVerify: (id) => void verifikasi.push(id),
			versi: () => undefined,
			probe: { kandidat: CEPAT, ackTimeoutMs: 3000, baselineMs: 300 },
			io: {
				stdout: (s) => void out.push(s),
				stderr: (s) => void err.push(s),
				stdin: async () => {
					if (stdin === undefined) throw new UsageError("stdin kosong");
					return stdin;
				},
			},
			...tambahan,
		});
		return { kode, out, err, teks: out.join("\n") };
	};
	const daftar = async () => {
		for (const [i, a] of agen.entries())
			await jalan([
				"register",
				a.nama,
				"--target",
				`${i + 1}:0.0`,
				"--jenis",
				"agy",
				"--tanpa-probe",
			]);
	};
	const diterima = (n: string): string[] => {
		try {
			return readFileSync(log(n), "utf8").trim().split("\n").filter(Boolean);
		} catch {
			return [];
		}
	};
	return { dir, repo, tmux, jalan, daftar, diterima, verifikasi, configHome };
}

test("--version, --help, dan perintah tidak dikenal", async (t) => {
	const { jalan } = await siapkan(t);
	assert.equal((await jalan(["--version"])).teks, pkg.version);
	const bantuan = await jalan(["--help"]);
	assert.equal(bantuan.kode, 0);
	assert.match(bantuan.teks, /send <agent>/);
	const salah = await jalan(["tidak-ada"]);
	assert.equal(salah.kode, 2);
	assert.match(salah.err.join(""), /tidak-ada/);
	assert.equal(salah.out.length, 0);
});

test("scan melaporkan agent dalam repo sebagai kandidat berkeyakinan tinggi", async (t) => {
	const { jalan, repo, tmux } = await siapkan(t);
	tmux.newSession("1", repo, "agy");
	tmux.newSession("2", repo, "codex");
	type Pindai = {
		kandidat: { jenis: string; keyakinan: string; target: string }[];
	};
	const hasil = await untilAsync(async () => {
		const pindai = JSON.parse((await jalan(["scan"])).teks) as Pindai;
		return pindai.kandidat.filter((c) => c.keyakinan === "tinggi").length === 2
			? pindai
			: undefined;
	});
	assert.deepEqual(hasil.kandidat.map((c) => [c.target, c.jenis]).sort(), [
		["1:0.0", "agy"],
		["2:0.0", "codex"],
	]);
});

test("register memprobe agent dan ls menampilkan hasilnya", async (t) => {
	const { jalan } = await siapkan(t, [{ nama: "agy", env: { FAKE_ACK: "1" } }]);
	const r = await jalan([
		"register",
		"agy",
		"--target",
		"1:0.0",
		"--jenis",
		"agy",
		"--kemampuan",
		"playwright",
	]);
	assert.equal(r.kode, 0, r.err.join());
	assert.match(r.teks, /^agy\s+✓ siap\s+ack/);
	const ls = await jalan(["ls"]);
	assert.match(ls.teks, /agy\s+siap\s+playwright\s+ack/);
});

test("register: argumen kurang dan pane tidak ada", async (t) => {
	const { jalan } = await siapkan(t, [{ nama: "agy" }]);
	assert.equal((await jalan(["register", "agy"])).kode, 2);
	const hilang = await jalan([
		"register",
		"x",
		"--target",
		"9:0.0",
		"--tanpa-probe",
	]);
	assert.equal(hilang.kode, 1);
	assert.match(hilang.err.join(""), /9:0\.0.*tidak ada/);
	assert.equal(
		(await jalan(["probe", "agy", "--profil", "bukan json"])).kode,
		2,
	);
});

test("send dengan brief tidak lengkap: kode 2 dan kekurangannya disebut", async (t) => {
	const { jalan, daftar } = await siapkan(t, [{ nama: "agy" }]);
	await daftar();
	const r = await jalan(["send", "agy"], "TUJUAN: saja");
	assert.equal(r.kode, 2);
	assert.match(r.err.join(""), /CAKUPAN/);
	assert.match(r.err.join(""), /CEK/);
});

test("alur protokol lengkap: send, brief, paham, edit, reply, verifikasi, lalu log, show, diff, dan report", async (t) => {
	const { jalan, daftar, repo, diterima, verifikasi, dir } = await siapkan(t, [
		{ nama: "agy" },
	]);
	await daftar();

	const kirim = await jalan(["send", "agy"], EDIT());
	assert.match(kirim.teks, /^T1 berjalan/);
	await until(() => (diterima("agy").length ? true : undefined));
	assert.match(diterima("agy")[0] ?? "", /rempug brief T1/);

	const brief = await jalan(["brief", "T1"]);
	assert.match(brief.teks, /TUJUAN: Ubah kolom/);
	assert.match(brief.teks, /rempug paham T1/);
	assert.equal((await jalan(["paham", "1"], PAHAM())).teks, "LANJUT");

	writeFileSync(join(repo, "src/a.ts"), "satu\nDUA\ntiga\nempat\n");
	const balas = await jalan(["reply", "1"], "HASIL: kolom diubah\nBUKTI: diff");
	assert.match(balas.teks, /OK T1 diterima/);
	assert.deepEqual(verifikasi, [1]);
	assert.equal((await jalan(["_verify", "1"])).kode, 0);

	assert.match(
		(await jalan(["log"])).teks,
		/^T1 agy ✓ 1 file \+2\/−1 \| scope OK \| echo ✓$/m,
	);
	const show = await jalan(["show", "1"]);
	assert.match(show.teks, /T1 agy selesai \(edit\)/);
	assert.match(show.teks, /ringkasan:\n {2}HASIL: kolom diubah/);
	assert.match(
		(await jalan(["show", "1", "--penuh"])).teks,
		/brief:\n {2}TUJUAN: Ubah kolom/,
	);
	// Ada kejadian tertunda dan tidak ada watch, jadi baris pertama adalah penanda; isinya di baris terakhir.
	assert.equal((await jalan(["diff", "1"])).out.at(-1), "M src/a.ts +2/−1");
	assert.match((await jalan(["diff", "1", "src/a.ts"])).teks, /\+DUA/);
	assert.match((await jalan(["report"])).teks, /selesai \(1\)\n {2}T1 agy ✓/);
	const md = join(dir, "laporan.md");
	assert.match((await jalan(["report", "--md", md])).teks, /laporan ditulis/);
	assert.match(readFileSync(md, "utf8"), /^# Laporan rempug/);
});

test("paham yang tidak cocok menahan tugas; jawab lalu tunggu melepasnya", async (t) => {
	const { jalan, daftar } = await siapkan(t, [{ nama: "agy" }]);
	await daftar();
	await jalan(["send", "agy"], EDIT());
	const r = await jalan(["paham", "1"], PAHAM("1. Ubah package.json"));
	assert.match(r.teks, /^MENUNGGU: .*di luar cakupan.*package\.json/);
	assert.match(r.teks, /rempug tunggu T1/);
	assert.match(
		(await jalan(["jawab", "1", "abaikan package.json"])).teks,
		/jawaban disimpan/,
	);
	assert.equal(
		(await jalan(["tunggu", "1"])).teks,
		"JAWABAN: abaikan package.json\nLANJUT",
	);
});

test("jawab pada tugas berjalan menyuntikkan teks ke agent", async (t) => {
	const { jalan, daftar, diterima } = await siapkan(t, [{ nama: "agy" }]);
	await daftar();
	await jalan(["send", "agy"], BACA);
	await until(() => (diterima("agy").length ? true : undefined));
	assert.match(
		(await jalan(["jawab", "1", "pakai", "opsi", "B"])).teks,
		/dikirim ke agent/,
	);
	await until(() => (diterima("agy").length === 2 ? true : undefined));
	assert.equal(diterima("agy")[1], "pakai opsi B");
});

test("reply --gagal menandai gagal dan melepas antrean", async (t) => {
	const { jalan, daftar, diterima } = await siapkan(t, [{ nama: "agy" }]);
	await daftar();
	await jalan(["send", "agy"], BACA);
	assert.match(
		(await jalan(["send", "agy", "--queue"], BACA)).teks,
		/^T2 antri/,
	);
	const r = await jalan(["reply", "1", "--gagal"], "limit habis");
	assert.match(r.teks, /ditandai gagal/);
	assert.match((await jalan(["log"])).teks, /T1 agy ✗ gagal: limit habis/);
	await until(() => (diterima("agy").length === 2 ? true : undefined));
	assert.match(diterima("agy")[1] ?? "", /rempug brief T2/);
});

test("tugas antrean dikirim setelah verifikasi tugas sebelumnya selesai", async (t) => {
	const { jalan, daftar, diterima } = await siapkan(t, [{ nama: "agy" }]);
	await daftar();
	await jalan(["send", "agy"], BACA);
	await jalan(["send", "agy", "--queue"], BACA);
	await jalan(["reply", "1"], "ok");
	await jalan(["_verify", "1"]);
	await until(() => (diterima("agy").length === 2 ? true : undefined));
	assert.match(diterima("agy")[1] ?? "", /rempug brief T2/);
});

test("--centang mencentang item tasks.md hanya setelah verifikasi lulus", async (t) => {
	const { jalan, daftar, repo } = await siapkan(t, [{ nama: "agy" }]);
	await daftar();
	await jalan(["send", "agy", "--centang", "spec/tasks.md#2"], EDIT());
	await jalan(["paham", "1"], PAHAM());
	await jalan(["reply", "1"], "ok");
	await jalan(["_verify", "1"]);
	assert.equal(
		readFileSync(join(repo, "spec/tasks.md"), "utf8"),
		"- [ ] 1. Satu\n- [x] 2. Dua\n",
	);

	await jalan(["send", "agy", "--centang", "spec/tasks.md#1"], EDIT("false"));
	await jalan(["reply", "2"], "ok");
	await jalan(["_verify", "2"]);
	assert.match(
		readFileSync(join(repo, "spec/tasks.md"), "utf8"),
		/- \[ \] 1\. Satu/,
	);
});

test("penanda kejadian tertunda muncul di perintah orkestrator dan hilang setelah terima", async (t) => {
	const { jalan, daftar } = await siapkan(t, [{ nama: "agy" }]);
	await daftar();
	await jalan(["send", "agy"], BACA);
	await jalan(["reply", "1"], "ok");
	await jalan(["_verify", "1"]);

	const ls = await jalan(["ls"]);
	assert.match(
		ls.out[0] ?? "",
		/^\[1 kejadian belum disampaikan.*rempug terima/,
	);
	assert.match((await jalan(["terima"])).teks, /^T1 agy ✓ baca/);
	assert.doesNotMatch((await jalan(["ls"])).out[0] ?? "", /^\[/);
	assert.equal((await jalan(["terima"])).out.length, 0);
});

test("perintah untuk agent tidak menempelkan penanda", async (t) => {
	const { jalan, daftar } = await siapkan(t, [{ nama: "agy" }]);
	await daftar();
	await jalan(["send", "agy"], BACA);
	await jalan(["reply", "1"], "ok");
	await jalan(["_verify", "1"]);
	assert.doesNotMatch((await jalan(["brief", "1"])).out[0] ?? "", /^\[/);
});

test("status: satu baris; membersihkan agent yang sesinya hilang", async (t) => {
	const { jalan, daftar, tmux, configHome } = await siapkan(t, [
		{ nama: "agy" },
		{ nama: "codex" },
	]);
	await daftar();
	const baris = (await jalan(["status"])).out;
	assert.equal(baris.length, 1);
	assert.match(baris[0] ?? "", /^rempug: agy siap, codex siap \| pantau mati$/);

	tmux.killSession("2");
	assert.match((await jalan(["status"])).teks, /dibersihkan: codex/);
	assert.deepEqual(
		readAgents(join(configHome, "rempug", "registry.json")).map((a) => a.name),
		["agy"],
	);
});

test("status tanpa agent mengarahkan ke /rempug", async (t) => {
	const { jalan } = await siapkan(t);
	assert.equal(
		(await jalan(["status"])).teks,
		"rempug: belum ada agent; jalankan /rempug",
	);
});

test("watch mencetak kejadian satu baris dan berhenti dengan sinyal", async (t) => {
	const { jalan, daftar } = await siapkan(t, [{ nama: "agy" }]);
	await daftar();
	await jalan(["send", "agy"], BACA);
	const kontrol = new AbortController();
	const baris: string[] = [];
	const w = jalan(["watch"], undefined, {
		sinyal: kontrol.signal,
		watchMs: 20,
		tickSetiap: 1000,
		io: {
			stdout: (s: string) => void baris.push(s),
			stderr: () => {},
			stdin: async () => "",
		},
	});
	await jalan(["reply", "1"], "ok");
	await jalan(["_verify", "1"]);
	await until(() => (baris.length ? true : undefined));
	kontrol.abort();
	assert.equal((await w).kode, 0);
	assert.deepEqual(baris, ["T1 agy ✓ baca | ok"]);
});

test("layar menampilkan isi pane agent; agent tidak terdaftar ditolak", async (t) => {
	const { jalan, daftar } = await siapkan(t, [{ nama: "agy" }]);
	await daftar();
	assert.match((await jalan(["layar", "agy"])).teks, /fake-agent/);
	assert.equal((await jalan(["layar", "tidak-ada"])).kode, 1);
});

test("id tidak valid dan tugas tidak ada", async (t) => {
	const { jalan } = await siapkan(t);
	assert.equal((await jalan(["show", "abc"])).kode, 2);
	const r = await jalan(["reply", "99"], "x");
	assert.equal(r.kode, 1);
	assert.match(r.err.join(""), /T99/);
});

test("doctor mencetak satu baris per pemeriksaan", async (t) => {
	const { jalan } = await siapkan(t);
	const r = await jalan(["doctor"]);
	assert.ok([0, 1].includes(r.kode));
	assert.match(r.teks, /^✓ node/m);
	assert.match(r.teks, /^✓ tmux/m);
});
