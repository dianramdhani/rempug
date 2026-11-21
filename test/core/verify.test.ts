import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gitInfo } from "../../src/core/git.js";
import { Ledger, type Task } from "../../src/core/ledger.js";
import {
	checkLabel,
	computeChanges,
	formatLine,
	outsideScope,
	parseFailureCount,
	runChecks,
	takeSnapshot,
	unifiedDiff,
	type VerifyResult,
	verifyTask,
} from "../../src/core/verify.js";
import { gitRepo, tmp } from "../helpers.js";

const BERKAS = {
	"src/a.ts": "satu\ndua\ntiga\n",
	"src/sub/b.ts": "bee\n",
	"lib/c.ts": "cee\n",
};

function brief(cek: string[], cakupan = "edit src/**") {
	return `TUJUAN: Uji\nCAKUPAN: ${cakupan}\nLANGKAH:\n1. Ubah.\nCEK:\n${cek.join("\n") || "-"}\nBALASAN: hasil`;
}

function siapkan(
	t: Parameters<typeof tmp>[0],
	opsi: {
		cek?: string[];
		scope?: string[];
		berkas?: Record<string, string>;
	} = {},
) {
	const repo = gitRepo(t, opsi.berkas ?? BERKAS);
	const ledger = Ledger.open(join(tmp(t), "l.db"));
	t.after(() => ledger.close());
	const scope = opsi.scope ?? ["src/**"];
	const git = gitInfo(repo);
	const id = ledger.createTask({
		repo,
		agent: "codex",
		mode: "edit",
		scope,
		brief: brief(opsi.cek ?? ["true"], `edit ${scope.join(" ")}`),
		headSha: git.head,
		branch: git.branch,
		porcelain: git.porcelain,
	});
	ledger.setStatus(id, "berjalan");
	const task = () => ledger.getTask(id) as Task;
	return { repo, ledger, id, task };
}

const tulis = (repo: string, path: string, isi: string | Buffer) => {
	const full = join(repo, path);
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, isi);
};

test("takeSnapshot menyimpan berkas dalam cakupan (terlacak dan baru), bukan di luarnya", (t) => {
	const { repo, ledger, id, task } = siapkan(t);
	tulis(repo, "src/baru.ts", "n\n");
	assert.equal(takeSnapshot(ledger, task(), repo), 3);
	assert.deepEqual(
		ledger.getSnapshots(id).map((s) => s.path),
		["src/a.ts", "src/baru.ts", "src/sub/b.ts"],
	);
	assert.ok(ledger.getSnapshots(id).every((s) => s.content !== null));
});

test("takeSnapshot: berkas biner dan besar hanya disimpan hash-nya", (t) => {
	const { repo, ledger, id, task } = siapkan(t, {
		berkas: { "src/a.ts": "x" },
	});
	tulis(repo, "src/gambar.bin", Buffer.from([1, 2, 0, 3]));
	tulis(repo, "src/besar.txt", "x".repeat(1024 * 1024 + 1));
	takeSnapshot(ledger, task(), repo);
	const per = Object.fromEntries(
		ledger.getSnapshots(id).map((s) => [s.path, s]),
	);
	assert.equal(per["src/gambar.bin"]?.content, null);
	assert.equal(per["src/besar.txt"]?.content, null);
	assert.ok(per["src/gambar.bin"]?.hash);
	assert.ok(per["src/a.ts"]?.content);
});

test("takeSnapshot menolak direktori yang bukan repo git", (t) => {
	const ledger = Ledger.open(join(tmp(t), "l.db"));
	t.after(() => ledger.close());
	const dir = tmp(t);
	const id = ledger.createTask({
		repo: dir,
		agent: "x",
		mode: "edit",
		scope: ["src"],
		brief: "b",
	});
	assert.throws(
		() => takeSnapshot(ledger, ledger.getTask(id) as Task, dir),
		/repo git/,
	);
});

test("computeChanges: ubah, tambah, hapus, dan hitung baris +/-", (t) => {
	const { repo, ledger, task } = siapkan(t);
	takeSnapshot(ledger, task(), repo);
	tulis(repo, "src/a.ts", "satu\nDUA\ntiga\nempat\n");
	tulis(repo, "src/baru.ts", "1\n2\n3\n");
	rmSync(join(repo, "src/sub/b.ts"));
	tulis(repo, "lib/c.ts", "diubah di luar cakupan\n");
	assert.deepEqual(computeChanges(ledger, task(), repo), [
		{ path: "src/a.ts", status: "M", plus: 2, minus: 1 },
		{ path: "src/baru.ts", status: "A", plus: 3, minus: 0 },
		{ path: "src/sub/b.ts", status: "D", plus: 0, minus: 1 },
	]);
});

test("computeChanges: tanpa perubahan kosong; berkas biner ditandai", (t) => {
	const { repo, ledger, task } = siapkan(t, { berkas: { "src/a.ts": "x\n" } });
	tulis(repo, "src/g.bin", Buffer.from([0, 1, 2]));
	takeSnapshot(ledger, task(), repo);
	assert.deepEqual(computeChanges(ledger, task(), repo), []);
	tulis(repo, "src/g.bin", Buffer.from([0, 9, 9, 9]));
	assert.deepEqual(computeChanges(ledger, task(), repo), [
		{ path: "src/g.bin", status: "M", plus: 0, minus: 0, biner: true },
	]);
});

test("unifiedDiff memakai header a/ b/, dan memotong keluaran panjang", (t) => {
	const { repo, ledger, task } = siapkan(t);
	takeSnapshot(ledger, task(), repo);
	tulis(repo, "src/a.ts", "satu\nDUA\ntiga\n");
	const diff = unifiedDiff(ledger, task(), repo, "src/a.ts");
	assert.match(diff, /--- a\/src\/a\.ts/);
	assert.match(diff, /\+\+\+ b\/src\/a\.ts/);
	assert.match(diff, /-dua/);
	assert.match(diff, /\+DUA/);
	assert.doesNotMatch(diff, /rempug-diff/);

	tulis(
		repo,
		"src/a.ts",
		Array.from({ length: 300 }, (_, i) => `baris ${i}`).join("\n"),
	);
	const panjang = unifiedDiff(ledger, task(), repo, "src/a.ts", 50);
	assert.equal(panjang.split("\n").length, 51);
	assert.match(panjang, /dipotong/);
	assert.match(
		unifiedDiff(ledger, task(), repo, "src/sub/b.ts"),
		/tidak ada perubahan/,
	);
	assert.throws(
		() => unifiedDiff(ledger, task(), repo, "tidak/ada.ts"),
		/tidak ada/,
	);
});

test("outsideScope: hanya nama berkas yang berubah di luar cakupan, bukan milik user sebelumnya atau tugas lain", (t) => {
	const repo = gitRepo(t, BERKAS);
	tulis(repo, "lib/lama.ts", "sudah kotor sebelum tugas\n");
	const ledger = Ledger.open(join(tmp(t), "l.db"));
	t.after(() => ledger.close());
	const git = gitInfo(repo);
	const buat = (scope: string[], status: "berjalan" | "memverifikasi") => {
		const id = ledger.createTask({
			repo,
			agent: "a",
			mode: "edit",
			scope,
			brief: "b",
			porcelain: git.porcelain,
		});
		ledger.setStatus(id, status);
		return ledger.getTask(id) as Task;
	};
	const saya = buat(["src/**"], "memverifikasi");
	buat(["docs/**"], "berjalan");

	tulis(repo, "src/a.ts", "di dalam cakupan\n");
	tulis(repo, "lib/c.ts", "di luar\n");
	tulis(repo, "lib/lama.ts", "sudah kotor sebelum tugas\n");
	tulis(repo, "docs/x.md", "milik tugas lain\n");
	tulis(repo, "catatan.txt", "baru di akar\n");
	assert.deepEqual(outsideScope(ledger, saya, repo), [
		"catatan.txt",
		"lib/c.ts",
	]);
});

test("runChecks: lulus, gagal dengan jumlah, timeout, dan ekor keluaran dibatasi", (t) => {
	const dir = tmp(t);
	const [ok, gagal, lama, panjang] = runChecks(
		["true", "echo Found 2 errors && false", "sleep 5", "seq 1 100 && false"],
		dir,
		400,
	);
	assert.equal(ok?.ok, true);
	assert.equal(gagal?.ok, false);
	assert.equal(gagal?.gagal, 2);
	assert.equal(lama?.timeout, true);
	assert.equal(lama?.ok, false);
	assert.equal(panjang?.ekor.split("\n").length, 10);
	assert.match(panjang?.ekor ?? "", /100$/);
	assert.deepEqual(runChecks([], dir), []);
});

test("runChecks melaporkan direktori yang tidak ada sebagai gagal, bukan melempar", () => {
	const [hasil] = runChecks(["true"], "/tidak/ada/sama/sekali");
	assert.equal(hasil?.ok, false);
});

test("parseFailureCount mengenali tsc, biome, vitest, jest, dan node:test", () => {
	const kasus: [string, number | undefined][] = [
		["Found 3 errors.", 3],
		["Found 1 error", 1],
		[" Tests  2 failed | 10 passed (12)", 2],
		["Tests: 4 failed, 5 passed", 4],
		["ℹ fail 7", 7],
		["ℹ fail 0", undefined],
		["  3 failing", 3],
		["semua baik-baik saja", undefined],
	];
	for (const [teks, hasil] of kasus)
		assert.equal(parseFailureCount(teks), hasil, teks);
});

test("checkLabel mengambil nama alat, bukan pembungkusnya", () => {
	const kasus: [string, string][] = [
		["yarn tsc -b", "tsc"],
		["yarn check", "check"],
		["npx -y vitest run src/a.test.ts", "vitest"],
		["npm test", "test"],
		["biome check .", "biome"],
		["pnpm run lint", "lint"],
		["./node_modules/.bin/tsc --noEmit", "tsc"],
	];
	for (const [cmd, label] of kasus) assert.equal(checkLabel(cmd), label, cmd);
});

const hasil = (over: Partial<VerifyResult> = {}): VerifyResult => ({
	ok: true,
	perubahan: [
		{ path: "a", status: "M", plus: 30, minus: 5 },
		{ path: "b", status: "A", plus: 11, minus: 2 },
		{ path: "c", status: "D", plus: 0, minus: 0 },
	],
	plus: 41,
	minus: 7,
	luarCakupan: [],
	cek: [
		{
			cmd: "yarn tsc -b",
			label: "tsc",
			ok: true,
			kode: 0,
			timeout: false,
			ekor: "",
		},
		{
			cmd: "yarn check",
			label: "biome",
			ok: true,
			kode: 0,
			timeout: false,
			ekor: "",
		},
		{
			cmd: "vitest",
			label: "vitest",
			ok: false,
			kode: 1,
			timeout: false,
			gagal: 2,
			ekor: "",
		},
	],
	tanpaPaham: false,
	linha: "",
	...over,
});

const edit = { id: 12, agent: "codex", mode: "edit" } as Task;

test("formatLine: satu baris ringkas untuk edit dengan cek gagal", () => {
	assert.equal(
		formatLine(edit, hasil({ ok: false })),
		"T12 codex ✗ 3 file +41/−7 | scope OK | tsc ✓ biome ✓ vitest ✗(2)",
	);
});

test("formatLine: lulus, di luar cakupan, tanpa paham, timeout, dan jumlah tidak diketahui", () => {
	const cek = hasil().cek.slice(0, 2);
	assert.equal(
		formatLine(edit, hasil({ cek })),
		"T12 codex ✓ 3 file +41/−7 | scope OK | tsc ✓ biome ✓",
	);
	assert.match(
		formatLine(
			edit,
			hasil({ cek, luarCakupan: ["x.ts", "y.ts", "z.ts", "w.ts"] }),
		),
		/scope ⚠ 4 di luar: x\.ts, y\.ts, z\.ts…/,
	);
	assert.match(
		formatLine(edit, hasil({ cek, tanpaPaham: true })),
		/\| ⚠ tanpa paham$/,
	);
	const tanpaHitung = {
		...hasil().cek[2],
		gagal: undefined,
	} as VerifyResult["cek"][number];
	assert.match(
		formatLine(edit, hasil({ ok: false, cek: [tanpaHitung] })),
		/vitest ✗$/,
	);
	const lama = { ...tanpaHitung, timeout: true };
	assert.match(
		formatLine(edit, hasil({ ok: false, cek: [lama] })),
		/vitest ⏱$/,
	);
	assert.equal(
		formatLine(edit, hasil({ cek: [], perubahan: [], plus: 0, minus: 0 })),
		"T12 codex ✓ 0 file +0/−0 | scope OK",
	);
});

test("formatLine: pelanggaran dan tugas baca", () => {
	assert.equal(
		formatLine(
			edit,
			hasil({ ok: false, pelanggaran: "HEAD berubah (abc1234→def5678)" }),
		),
		"T12 codex ⚠ pelanggaran: HEAD berubah (abc1234→def5678)",
	);
	const baca = {
		id: 3,
		agent: "agy",
		mode: "baca",
		replySummary: "3 selisih kolom\nlainnya",
	} as Task;
	assert.equal(
		formatLine(baca, hasil({ cek: [], perubahan: [] })),
		"T3 agy ✓ baca | 3 selisih kolom",
	);
	assert.match(
		formatLine(
			{ ...baca, replySummary: "x".repeat(300) } as Task,
			hasil({ cek: [] }),
		),
		/^T3 agy ✓ baca \| x{99}…$/,
	);
});

test("verifyTask lulus: status selesai, event dan hasil tersimpan", (t) => {
	const { repo, ledger, id, task } = siapkan(t, { cek: ["true", "echo ok"] });
	takeSnapshot(ledger, task(), repo);
	ledger.patch(id, { paham: "ada" });
	ledger.setStatus(id, "memverifikasi");
	tulis(repo, "src/a.ts", "satu\nDUA\ntiga\n");

	const r = verifyTask(ledger, id);
	assert.equal(r.ok, true);
	assert.equal(ledger.getTask(id)?.status, "selesai");
	assert.match(
		r.linha,
		/^T\d+ codex ✓ 1 file \+1\/−1 \| scope OK \| true ✓ echo ✓$/,
	);
	assert.equal(JSON.parse(ledger.getTask(id)?.verify ?? "{}").linha, r.linha);
	const event = ledger.eventsAfter(0, repo).at(-1);
	assert.equal(event?.kind, "selesai");
	assert.equal(event?.line, r.linha);
});

test("verifyTask: cek yang gagal menandai tugas gagal walau agent mengaku beres", (t) => {
	const { repo, ledger, id, task } = siapkan(t, {
		cek: ["echo Found 2 errors && false"],
	});
	takeSnapshot(ledger, task(), repo);
	ledger.patch(id, { paham: "ada" });
	ledger.setStatus(id, "memverifikasi");
	const r = verifyTask(ledger, id);
	assert.equal(r.ok, false);
	assert.equal(ledger.getTask(id)?.status, "gagal");
	assert.match(r.linha, /echo ✗\(2\)/);
	assert.equal(ledger.eventsAfter(0, repo).at(-1)?.kind, "gagal");
});

test("verifyTask: commit atau pindah branch oleh agent adalah pelanggaran", (t) => {
	for (const aksi of ["commit", "branch"]) {
		const { repo, ledger, id, task } = siapkan(t);
		takeSnapshot(ledger, task(), repo);
		ledger.patch(id, { paham: "ada" });
		ledger.setStatus(id, "memverifikasi");
		if (aksi === "commit") {
			tulis(repo, "src/a.ts", "baru\n");
			execFileSync("git", ["-C", repo, "commit", "-aqm", "diam-diam"]);
		} else execFileSync("git", ["-C", repo, "checkout", "-qb", "cabang-lain"]);
		const r = verifyTask(ledger, id);
		assert.equal(r.ok, false, aksi);
		assert.equal(ledger.getTask(id)?.status, "pelanggaran", aksi);
		assert.match(
			r.linha,
			aksi === "commit"
				? /pelanggaran: HEAD berubah/
				: /pelanggaran: branch berubah \(main→cabang-lain\)/,
		);
	}
});

test("verifyTask menandai tugas edit tanpa paham, dan perubahan di luar cakupan", (t) => {
	const { repo, ledger, id, task } = siapkan(t);
	takeSnapshot(ledger, task(), repo);
	ledger.setStatus(id, "memverifikasi");
	tulis(repo, "lib/c.ts", "diubah\n");
	const r = verifyTask(ledger, id);
	assert.equal(r.tanpaPaham, true);
	assert.deepEqual(r.luarCakupan, ["lib/c.ts"]);
	assert.match(r.linha, /scope ⚠ 1 di luar: lib\/c\.ts/);
	assert.match(r.linha, /⚠ tanpa paham$/);
	assert.equal(ledger.getTask(id)?.status, "selesai");
});

test("verifyTask untuk tugas baca: tanpa diff, ringkasan balasan di baris", (t) => {
	const repo = gitRepo(t);
	const ledger = Ledger.open(join(tmp(t), "l.db"));
	t.after(() => ledger.close());
	const id = ledger.createTask({
		repo,
		agent: "agy",
		mode: "baca",
		brief:
			"TUJUAN: Cek\nCAKUPAN: baca\nLANGKAH:\n1. Lihat.\nCEK: -\nBALASAN: hasil",
	});
	ledger.setStatus(id, "memverifikasi");
	ledger.saveReply(id, "3 selisih kolom", "3 selisih kolom\nrinci");
	const r = verifyTask(ledger, id);
	assert.equal(r.linha, `T${id} agy ✓ baca | 3 selisih kolom`);
	assert.equal(ledger.getTask(id)?.status, "selesai");
});

test("verifyTask hanya untuk tugas yang sedang memverifikasi", (t) => {
	const { ledger, id } = siapkan(t);
	assert.throws(() => verifyTask(ledger, id), /berjalan/);
	assert.throws(() => verifyTask(ledger, 999), /T999/);
});

test("outsideScope: perubahan tugas edit lain yang jendela waktunya beririsan tidak dianggap di luar cakupan", (t) => {
	let jam = 100;
	const repo = gitRepo(t, BERKAS);
	const ledger = Ledger.open(join(tmp(t), "l.db"), { now: () => jam });
	t.after(() => ledger.close());
	const git = gitInfo(repo);
	const buat = (scope: string[]) =>
		ledger.createTask({
			repo,
			agent: "x",
			mode: "edit",
			scope,
			brief: "b",
			porcelain: git.porcelain,
		});

	const a = buat(["docs/**"]); // dikirim 100
	jam = 101;
	const b = buat(["src/**"]); // dikirim 101
	jam = 105;
	ledger.saveReply(a, "ok", "ok");
	ledger.setStatus(a, "selesai"); // A selesai di tengah jendela B
	jam = 108;
	ledger.saveReply(b, "ok", "ok");
	ledger.setStatus(b, "memverifikasi");
	jam = 200;
	const c = buat(["lib/**"]); // C dikirim jauh sesudah B selesai
	jam = 205;
	ledger.saveReply(c, "ok", "ok");

	tulis(repo, "docs/x.md", "dari A\n");
	tulis(repo, "lib/c.ts", "dari C\n");
	tulis(repo, "catatan.txt", "milik siapa pun\n");
	const task = ledger.getTask(b) as Task;
	assert.deepEqual(
		outsideScope(ledger, task, repo),
		["catatan.txt", "lib/c.ts"],
		"docs/x.md milik A (jendela beririsan) dikecualikan; lib/c.ts milik C (tidak beririsan) tetap dilaporkan",
	);
});

test("tugas browser dan baca: CEK adalah deskripsi bukti, bukan perintah shell, jadi kalimat biasa tidak menggagalkan tugas", (t) => {
	for (const mode of ["browser", "baca"] as const) {
		const repo = gitRepo(t);
		const ledger = Ledger.open(join(tmp(t), "l.db"));
		t.after(() => ledger.close());
		const id = ledger.createTask({
			repo,
			agent: "agy",
			mode,
			brief: `TUJUAN: Cek halaman\nCAKUPAN: ${mode}\nLANGKAH:\n1. Buka halaman.\nCEK: snapshot halaman Devices berhasil diambil dan daftar request tercatat.\nBALASAN: ringkasan`,
		});
		ledger.setStatus(id, "memverifikasi");
		ledger.saveReply(
			id,
			"halaman terbuka, 6 GET 200",
			"halaman terbuka, 6 GET 200",
		);

		const r = verifyTask(ledger, id);
		assert.equal(r.ok, true, mode);
		assert.deepEqual(r.cek, [], `${mode}: tidak ada perintah yang dijalankan`);
		assert.equal(ledger.getTask(id)?.status, "selesai", mode);
		assert.equal(r.linha, `T${id} agy ✓ ${mode} | halaman terbuka, 6 GET 200`);
	}
});

test("readBrief tugas baca menjelaskan CEK sebagai bukti yang harus dilaporkan agent", async () => {
	const { readBrief } = await import("../../src/core/send.js");
	const dir = tmp({ after() {} } as never);
	const ledger = Ledger.open(join(dir, "l.db"));
	const id = ledger.createTask({
		repo: "/r",
		agent: "agy",
		mode: "browser",
		brief:
			"TUJUAN: x\nCAKUPAN: browser\nLANGKAH:\n1. a\nCEK: snapshot berhasil\nBALASAN: b",
	});
	ledger.setStatus(id, "berjalan");
	const teks = readBrief(ledger, id);
	ledger.close();
	assert.match(
		teks,
		/CEK untuk tugas ini adalah bukti yang harus kamu laporkan di BUKTI/,
	);
	assert.doesNotMatch(teks, /rempug paham/);
});
