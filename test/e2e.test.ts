/**
 * Uji ujung ke ujung: orkestrator memakai CLI nyata (termasuk `rempug watch` sebagai proses terpisah,
 * seperti Monitor), agent palsu menjalankan protokol lewat CLI nyata di tmux nyata, repo git nyata.
 */

import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tmuxTransport } from "../src/core/transport.js";
import { gitRepo, startTmux, tmp, until } from "./helpers.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const EDIT = (paths: string, cek: string) =>
	`TUJUAN: Ubah berkas\nCAKUPAN: edit ${paths}\nLANGKAH:\n1. Ubah.\nCEK:\n${cek}\nBALASAN: hasil`;
const BACA =
	"TUJUAN: Cek\nCAKUPAN: baca\nLANGKAH:\n1. Lihat.\nCEK: -\nBALASAN: hasil";

interface Spes {
	nama: string;
	perilaku?: string;
	edit?: string;
	/** `false`: agent hanya menerima baris lalu diam, tanpa menjalankan rempug. */
	protokol?: boolean;
}

async function dunia(
	t: Parameters<typeof tmp>[0],
	agen: Spes[],
	ambang: Record<string, string> = {},
) {
	const dir = tmp(t);
	const repo = gitRepo(t, {
		"src/a.ts": "satu\n",
		"src/b.ts": "bee\n",
		"lib/c.ts": "cee\n",
		"package.json": "{}\n",
	});
	const tmux = startTmux(t);
	const env: Record<string, string> = {
		...(Object.fromEntries(
			Object.entries(process.env).filter(([, v]) => v !== undefined),
		) as Record<string, string>),
		XDG_STATE_HOME: join(dir, "state"),
		XDG_CONFIG_HOME: join(dir, "config"),
		REMPUG_TMUX_SOCKET: tmux.opts.socket as string,
		REMPUG_WATCH_MS: "100",
		...ambang,
	};
	delete env.TMUX;
	const log = (n: string) => join(dir, `${n}.log`);
	for (const [i, a] of agen.entries())
		tmux.newFakeAgent(String(i + 1), repo, ["normal", log(a.nama)], {
			...env,
			...(a.protokol === false ? {} : { FAKE_CLI: cli }),
			FAKE_PERILAKU: a.perilaku ?? "patuh",
			FAKE_EDIT: a.edit ?? "",
		});

	const rempug = (args: string[], stdin?: string) =>
		new Promise<{ kode: number; out: string; err: string }>((resolve) => {
			const p = spawn(process.execPath, [cli, ...args], { env, cwd: repo });
			let out = "";
			let err = "";
			p.stdout.on("data", (d) => (out += d));
			p.stderr.on("data", (d) => (err += d));
			p.on("close", (kode) =>
				resolve({ kode: kode ?? -1, out: out.trim(), err: err.trim() }),
			);
			p.stdin.end(stdin ?? "");
		});

	const pantau = () => {
		const proc: ChildProcess = spawn(process.execPath, [cli, "watch"], {
			env,
			cwd: repo,
		});
		const baris: string[] = [];
		let sisa = "";
		proc.stdout?.on("data", (d) => {
			sisa += d;
			const bagian = sisa.split("\n");
			sisa = bagian.pop() ?? "";
			baris.push(...bagian.filter(Boolean));
		});
		t.after(() => void proc.kill());
		return { baris, berhenti: () => void proc.kill() };
	};

	// Agent didaftarkan tanpa probe agar uji fokus pada alur kerja, bukan pada kalibrasi.
	const transport = tmuxTransport(tmux.opts);
	for (const [i, a] of agen.entries()) {
		await until(() =>
			transport.layar(`${i + 1}:0.0`).includes("fake-agent") ? true : undefined,
		);
		const r = await rempug([
			"register",
			a.nama,
			"--target",
			`${i + 1}:0.0`,
			"--jenis",
			"agy",
			"--tanpa-probe",
		]);
		assert.equal(r.kode, 0, r.err);
	}
	const diterima = (n: string) => {
		try {
			return readFileSync(log(n), "utf8").trim().split("\n").filter(Boolean);
		} catch {
			return [];
		}
	};
	const status = () =>
		execFileSync("git", ["-C", repo, "status", "--porcelain", "-uall"], {
			encoding: "utf8",
		}).trimEnd();
	return { dir, repo, rempug, pantau, diterima, status };
}

const tunggu = <T>(fn: () => T | undefined, ms = 20_000) => until(fn, ms);

test("alur patuh: kirim, paham, ubah, balas, verifikasi; kejadian sampai lewat watch dan repo hanya berubah sesuai tugas", async (t) => {
	const d = await dunia(t, [{ nama: "agy", edit: "src/a.ts" }]);
	const w = d.pantau();
	const kirim = await d.rempug(["send", "agy"], EDIT("src/**", "echo ok"));
	assert.match(kirim.out, /^T1 berjalan/);

	const baris = await tunggu(() => w.baris.find((b) => b.startsWith("T1 ")));
	assert.match(baris, /^T1 agy ✓ 1 file \+1\/−0 \| scope OK \| echo ✓$/);
	assert.equal(d.status(), " M src/a.ts");
	assert.match(
		readFileSync(join(d.repo, "src/a.ts"), "utf8"),
		/diubah agent T1/,
	);
	assert.match(
		(await d.rempug(["show", "1", "--penuh"])).out,
		/HASIL: selesai/,
	);
});

test("dua agent: tugas yang cakupannya beririsan ditolak, yang tidak beririsan berjalan paralel", async (t) => {
	const d = await dunia(t, [
		{ nama: "agy", edit: "src/a.ts" },
		{ nama: "codex", edit: "lib/c.ts" },
	]);
	const w = d.pantau();
	assert.match(
		(await d.rempug(["send", "agy"], EDIT("src/**", "echo ok"))).out,
		/^T1 berjalan/,
	);
	const bentrok = await d.rempug(
		["send", "codex"],
		EDIT("src/a.ts", "echo ok"),
	);
	assert.equal(bentrok.kode, 1);
	assert.match(bentrok.err, /bentrok dengan T1/);
	assert.match(
		(await d.rempug(["send", "codex"], EDIT("lib/**", "echo ok"))).out,
		/^T2 berjalan/,
	);

	await tunggu(() =>
		w.baris.filter((b) => b.includes("✓")).length === 2 ? true : undefined,
	);
	assert.deepEqual(d.status().split("\n").sort(), [
		" M lib/c.ts",
		" M src/a.ts",
	]);
});

test("pemahaman menyimpang menahan tugas; jawaban orkestrator melepasnya dan tugas selesai", async (t) => {
	const d = await dunia(t, [
		{ nama: "agy", perilaku: "menyimpang", edit: "src/a.ts" },
	]);
	const w = d.pantau();
	await d.rempug(["send", "agy"], EDIT("src/**", "echo ok"));

	const tahan = await tunggu(() =>
		w.baris.find((b) => b.includes("menunggu-klarifikasi")),
	);
	assert.match(
		tahan,
		/T1 agy menunggu-klarifikasi: rencana menyentuh di luar cakupan: package\.json/,
	);
	assert.equal(
		d.status(),
		"",
		"agent tidak boleh mengubah apa pun sebelum disetujui",
	);

	assert.match(
		(await d.rempug(["jawab", "1", "abaikan package.json"])).out,
		/jawaban disimpan/,
	);
	const selesai = await tunggu(() => w.baris.find((b) => b.includes("✓")));
	assert.match(selesai, /^T1 agy ✓ 1 file/);
	assert.equal(d.status(), " M src/a.ts");
});

test("agent yang mengaku beres tetapi cek gagal ditandai gagal oleh rempug", async (t) => {
	const d = await dunia(t, [
		{ nama: "agy", perilaku: "curang", edit: "src/a.ts" },
	]);
	const w = d.pantau();
	await d.rempug(["send", "agy"], EDIT("src/**", "test -f src/baru.ts"));
	const baris = await tunggu(() => w.baris.find((b) => b.startsWith("T1 ")));
	assert.match(baris, /^T1 agy ✗ 0 file \+0\/−0 \| scope OK \| test ✗$/);
	assert.match((await d.rempug(["log"])).out, /✗/);
});

test("commit diam-diam oleh agent adalah pelanggaran", async (t) => {
	const d = await dunia(t, [
		{ nama: "agy", perilaku: "commit", edit: "src/a.ts" },
	]);
	const w = d.pantau();
	await d.rempug(["send", "agy"], EDIT("src/**", "echo ok"));
	const baris = await tunggu(() =>
		w.baris.find((b) => b.includes("pelanggaran")),
	);
	assert.match(
		baris,
		/^T1 agy ⚠ pelanggaran: commit baru mengubah berkas di cakupan tugas \([0-9a-f]{7}→[0-9a-f]{7}\): src\/a\.ts$/,
	);
});

test("agent yang melewati konfirmasi pemahaman ditandai di baris hasil", async (t) => {
	const d = await dunia(t, [
		{ nama: "agy", perilaku: "tanpa-paham", edit: "src/a.ts" },
	]);
	const w = d.pantau();
	await d.rempug(["send", "agy"], EDIT("src/**", "echo ok"));
	const baris = await tunggu(() => w.baris.find((b) => b.startsWith("T1 ")));
	assert.match(baris, /✓ 1 file .*⚠ tanpa paham$/);
});

test("agent yang menerima pointer tetapi tidak menjalankan rempug dilaporkan pemantau, sekali", async (t) => {
	const d = await dunia(t, [{ nama: "agy", protokol: false }], {
		REMPUG_ACK_DETIK: "2",
		REMPUG_DIAM_DETIK: "1",
		REMPUG_MACET_DETIK: "60",
	});
	const w = d.pantau();
	await d.rempug(["send", "agy"], BACA);
	const baris = await tunggu(
		() => w.baris.find((b) => b.includes("T1 ")),
		25_000,
	);
	assert.match(baris, /^T1 agy diterima-tanpa-ack: pointer terkirim/);
	await new Promise((r) => setTimeout(r, 1500));
	assert.equal(
		w.baris.filter((b) => b.startsWith("T1 ")).length,
		1,
		"tidak boleh dilaporkan berulang",
	);
	assert.equal(
		d.diterima("agy").length,
		1,
		"pointer tidak boleh dikirim ulang",
	);
});

test("agent yang bertanya dilaporkan, dan jawaban disuntikkan ke agent", async (t) => {
	const d = await dunia(t, [{ nama: "agy", perilaku: "ack-lalu-tanya" }], {
		REMPUG_ACK_DETIK: "2",
		REMPUG_DIAM_DETIK: "1",
		REMPUG_MACET_DETIK: "60",
	});
	const w = d.pantau();
	await d.rempug(["send", "agy"], BACA);

	const baris = await tunggu(
		() => w.baris.find((b) => b.includes("bertanya")),
		25_000,
	);
	assert.match(
		baris,
		/^T1 agy bertanya: Which option do you prefer, A or B\? \| jawab: rempug jawab T1/,
	);
	assert.match(
		(await d.rempug(["jawab", "1", "pakai", "opsi", "B"])).out,
		/dikirim ke agent/,
	);
	await tunggu(() =>
		d.diterima("agy").includes("pakai opsi B") ? true : undefined,
	);
});

test("watch yang dipasang ulang menerima kejadian yang terlewat saat ia mati", async (t) => {
	const d = await dunia(t, [{ nama: "agy", edit: "src/a.ts" }]);
	const pertama = d.pantau();
	await d.rempug(["send", "agy"], EDIT("src/**", "echo ok"));
	await tunggu(() => (d.diterima("agy").length ? true : undefined));
	pertama.berhenti();

	// Tugas selesai ketika tidak ada pemantau yang hidup.
	let selesai = false;
	for (let i = 0; i < 200 && !selesai; i++) {
		selesai = /✓/.test((await d.rempug(["log"])).out);
		if (!selesai) await new Promise((r) => setTimeout(r, 100));
	}
	assert.ok(selesai, "tugas tidak selesai");

	const kedua = d.pantau();
	const baris = await tunggu(() =>
		kedua.baris.find((b) => b.startsWith("T1 ")),
	);
	assert.match(baris, /^T1 agy ✓/);
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(
		kedua.baris.filter((b) => b.startsWith("T1 ")).length,
		1,
		"kejadian tidak boleh terkirim dua kali",
	);
});
