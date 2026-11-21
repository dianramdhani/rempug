import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { parseBrief } from "./brief.js";
import { RempugError } from "./errors.js";
import { gitFiles, gitInfo, isGitRepo } from "./git.js";
import type { Ledger, Task } from "./ledger.js";
import { covers } from "./scope.js";

/** Berkas di atas ukuran ini hanya disimpan hash-nya, tanpa isi. */
const BATAS_BERKAS = 1024 * 1024;
const WAKTU_CEK_MS = 10 * 60_000;

const sha1 = (isi: Uint8Array) => createHash("sha1").update(isi).digest("hex");
const biner = (isi: Buffer) => isi.subarray(0, 8000).includes(0);

function baca(repo: string, path: string): Buffer | undefined {
	try {
		return readFileSync(join(repo, path));
	} catch {
		return undefined;
	}
}

/**
 * Menyimpan isi berkas dalam cakupan tugas (terlacak dan baru) ke ledger, supaya perubahan agent
 * dapat dihitung sendiri nanti. Tidak menulis apa pun ke repo, termasuk `.git`.
 */
export function takeSnapshot(ledger: Ledger, task: Task, repo: string): number {
	if (!isGitRepo(repo))
		throw new RempugError(`tugas edit membutuhkan repo git: ${repo}`);
	const berkas = gitFiles(repo, task.scope ?? []);
	for (const path of berkas) {
		const isi = baca(repo, path);
		if (!isi) continue;
		const simpan = isi.length <= BATAS_BERKAS && !biner(isi);
		ledger.addSnapshot(
			task.id,
			path,
			sha1(isi),
			simpan ? deflateSync(isi) : null,
		);
	}
	return berkas.length;
}

export interface FileChange {
	path: string;
	status: "M" | "A" | "D";
	plus: number;
	minus: number;
	biner?: true;
}

/** `[tambah, hapus]` antara dua berkas, atau `"biner"`. `/dev/null` berarti berkas tidak ada. */
function numstat(lama: string, baru: string): [number, number] | "biner" {
	const hasil = spawnSync(
		"git",
		["diff", "--no-index", "--numstat", "--", lama, baru],
		{
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		},
	);
	const cocok = /^(\S+)\t(\S+)\t/m.exec(hasil.stdout);
	if (!cocok) return [0, 0];
	return cocok[1] === "-" ? "biner" : [Number(cocok[1]), Number(cocok[2])];
}

/** Berkas yang berubah sejak snapshot, dengan jumlah baris +/−; dihitung dari isi, bukan dari klaim agent. */
export function computeChanges(
	ledger: Ledger,
	task: Task,
	repo: string,
): FileChange[] {
	const dir = mkdtempSync(join(tmpdir(), "rempug-diff-"));
	try {
		const snapshots = ledger.getSnapshots(task.id);
		const ada = new Set(snapshots.map((s) => s.path));
		const hasil: FileChange[] = [];
		const hitung = (
			path: string,
			status: FileChange["status"],
			lama: string,
			baru: string,
		) => {
			const n = numstat(lama, baru);
			hasil.push(
				n === "biner"
					? { path, status, plus: 0, minus: 0, biner: true }
					: { path, status, plus: n[0], minus: n[1] },
			);
		};
		snapshots.forEach((s, i) => {
			const sekarang = baca(repo, s.path);
			if (sekarang && sha1(sekarang) === s.hash) return;
			if (!s.content || (sekarang && biner(sekarang))) {
				hasil.push({
					path: s.path,
					status: sekarang ? "M" : "D",
					plus: 0,
					minus: 0,
					biner: true,
				});
				return;
			}
			const lama = join(dir, `lama-${i}`);
			writeFileSync(lama, inflateSync(s.content));
			if (sekarang) hitung(s.path, "M", lama, join(repo, s.path));
			else hitung(s.path, "D", lama, "/dev/null");
		});
		for (const path of gitFiles(repo, task.scope ?? [])) {
			if (ada.has(path)) continue;
			const sekarang = baca(repo, path);
			if (!sekarang) continue;
			if (biner(sekarang))
				hasil.push({ path, status: "A", plus: 0, minus: 0, biner: true });
			else hitung(path, "A", "/dev/null", join(repo, path));
		}
		return hasil.sort((a, b) => a.path.localeCompare(b.path));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Diff unified satu berkas terhadap snapshot, dipotong supaya tidak membanjiri orkestrator. */
export function unifiedDiff(
	ledger: Ledger,
	task: Task,
	repo: string,
	path: string,
	maksBaris = 200,
): string {
	const snapshot = ledger.getSnapshots(task.id).find((s) => s.path === path);
	const sekarang = baca(repo, path);
	if (!snapshot && !sekarang)
		throw new RempugError(
			`${path} tidak ada di snapshot T${task.id} maupun di disk`,
		);
	const dir = mkdtempSync(join(tmpdir(), "rempug-diff-"));
	try {
		let lama = "/dev/null";
		if (snapshot?.content) {
			lama = join(dir, "lama");
			writeFileSync(lama, inflateSync(snapshot.content));
		}
		const baru = sekarang ? join(repo, path) : "/dev/null";
		const hasil = spawnSync(
			"git",
			["diff", "--no-index", "--no-color", "--", lama, baru],
			{
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
			},
		);
		// Git menambah awalan a/ dan b/ di depan path absolut, jadi awalan itu ikut diganti.
		const teks = hasil.stdout
			.replaceAll(`a${lama}`, `a/${path}`)
			.replaceAll(`b${baru}`, `b/${path}`);
		if (!teks.trim()) return `(tidak ada perubahan pada ${path})`;
		const baris = teks.trimEnd().split("\n");
		if (baris.length <= maksBaris) return baris.join("\n");
		return [
			...baris.slice(0, maksBaris),
			`… ${baris.length - maksBaris} baris lagi dipotong`,
		].join("\n");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function parsePorcelain(teks: string | undefined): Map<string, string> {
	const peta = new Map<string, string>();
	for (const baris of (teks ?? "").split("\n").filter(Boolean)) {
		let path = baris.slice(3);
		if (path.includes(" -> ")) path = path.split(" -> ").pop() as string;
		peta.set(path.replace(/^"|"$/g, ""), baris);
	}
	return peta;
}

/**
 * Berkas yang berubah sejak tugas dikirim tetapi di luar cakupan tugas ini dan tugas edit aktif lain.
 * Hanya nama: bisa pelanggaran agent, bisa juga hasil edit user sendiri.
 */
export function outsideScope(
	ledger: Ledger,
	task: Task,
	repo: string,
): string[] {
	const awal = parsePorcelain(task.porcelain);
	const kini = parsePorcelain(gitInfo(repo).porcelain);
	const milikLain = ledger
		.activeEditTasks(task.repo)
		.filter((t) => t.id !== task.id)
		.flatMap((t) => t.scope ?? []);
	return [...kini]
		.filter(([path, baris]) => awal.get(path) !== baris)
		.map(([path]) => path)
		.filter(
			(path) => !covers(task.scope ?? [], path) && !covers(milikLain, path),
		)
		.sort();
}

export interface CheckResult {
	cmd: string;
	label: string;
	ok: boolean;
	kode: number | null;
	timeout: boolean;
	/** Jumlah kegagalan bila keluaran cocok pola alat yang dikenal. */
	gagal?: number;
	ekor: string;
}

const POLA_GAGAL = [
	/Found (\d+) errors?/i,
	/Tests?:?\s+(\d+) failed/i,
	/ℹ fail (\d+)/,
	/(\d+) failing/i,
];

/** Jumlah kegagalan dari keluaran alat yang dikenal (tsc, biome, vitest, jest, node:test); kosong bila tidak jelas. */
export function parseFailureCount(keluaran: string): number | undefined {
	for (const pola of POLA_GAGAL) {
		const n = Number(pola.exec(keluaran)?.[1]);
		if (n > 0) return n;
	}
	return undefined;
}

const PEMBUNGKUS = new Set([
	"yarn",
	"npm",
	"pnpm",
	"npx",
	"node",
	"run",
	"exec",
	"dlx",
	"sh",
	"bash",
	"bun",
	"bunx",
]);

/** Nama alat dari perintah, melewati pembungkus dan opsi: `yarn tsc -b` → `tsc`. */
export function checkLabel(cmd: string): string {
	const token = cmd
		.split(/\s+/)
		.filter(Boolean)
		.find((t) => !PEMBUNGKUS.has(t) && !t.startsWith("-"));
	return token ? basename(token) : cmd;
}

/** Menjalankan perintah cek satu per satu (semuanya, walau ada yang gagal) di root repo. */
export function runChecks(
	perintah: string[],
	cwd: string,
	waktuMs = WAKTU_CEK_MS,
): CheckResult[] {
	return perintah.map((cmd) => {
		const hasil = spawnSync("sh", ["-c", cmd], {
			cwd,
			encoding: "utf8",
			timeout: waktuMs,
			killSignal: "SIGKILL",
			maxBuffer: 32 * 1024 * 1024,
		});
		const keluaran = `${hasil.stdout ?? ""}${hasil.stderr ?? ""}${hasil.error && !hasil.stdout ? `\n${hasil.error.message}` : ""}`;
		const timeout =
			(hasil.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
		const ok = !hasil.error && hasil.status === 0;
		return {
			cmd,
			label: checkLabel(cmd),
			ok,
			kode: hasil.status,
			timeout,
			gagal: ok ? undefined : parseFailureCount(keluaran),
			ekor: keluaran.trimEnd().split("\n").slice(-10).join("\n"),
		};
	});
}

export interface VerifyResult {
	ok: boolean;
	pelanggaran?: string;
	perubahan: FileChange[];
	plus: number;
	minus: number;
	luarCakupan: string[];
	cek: CheckResult[];
	tanpaPaham: boolean;
	linha: string;
}

const pendek = (sha: string | undefined) => (sha ?? "?").slice(0, 7);

/** Satu baris ringkas hasil verifikasi, mis. `T12 codex ✓ 3 file +41/−7 | scope OK | tsc ✓ vitest ✗(2)`. */
export function formatLine(
	task: Pick<Task, "id" | "agent" | "mode" | "replySummary">,
	hasil: VerifyResult,
): string {
	const kepala = `T${task.id} ${task.agent}`;
	if (hasil.pelanggaran) return `${kepala} ⚠ pelanggaran: ${hasil.pelanggaran}`;
	const tanda = hasil.ok ? "✓" : "✗";
	const cek = hasil.cek.map((c) =>
		c.ok
			? `${c.label} ✓`
			: c.timeout
				? `${c.label} ⏱`
				: c.gagal
					? `${c.label} ✗(${c.gagal})`
					: `${c.label} ✗`,
	);
	const bagian: string[] = [];
	if (task.mode === "edit") {
		const luar = hasil.luarCakupan;
		bagian.push(
			`${hasil.perubahan.length} file +${hasil.plus}/−${hasil.minus}`,
		);
		bagian.push(
			luar.length === 0
				? "scope OK"
				: `scope ⚠ ${luar.length} di luar: ${luar.slice(0, 3).join(", ")}${luar.length > 3 ? "…" : ""}`,
		);
	} else {
		const baris = (task.replySummary ?? "").split("\n")[0] ?? "";
		bagian.push(
			`${task.mode} | ${baris.length > 100 ? `${baris.slice(0, 99)}…` : baris}`.trimEnd(),
		);
	}
	// Untuk tugas baca, bagian pertama sudah memuat "baca | ringkasan"; cek menyusul setelahnya.
	const dasar = `${kepala} ${tanda} ${task.mode === "edit" ? bagian.join(" | ") : bagian[0]}`;
	const akhir = [
		...(cek.length ? [cek.join(" ")] : []),
		...(hasil.tanpaPaham ? ["⚠ tanpa paham"] : []),
	];
	return [dasar, ...akhir].join(" | ");
}

/**
 * Memverifikasi tugas yang sudah dibalas agent: perubahan berkas, cek penerimaan, dan commit.
 * Mengubah status menjadi selesai, gagal, atau pelanggaran, dan menulis satu event.
 */
export function verifyTask(
	ledger: Ledger,
	id: number,
	options: { waktuCekMs?: number } = {},
): VerifyResult {
	const task = ledger.getTask(id);
	if (!task) throw new RempugError(`tugas T${id} tidak ada`);
	if (task.status !== "memverifikasi")
		throw new RempugError(
			`tugas T${id} berstatus ${task.status}; tidak sedang memverifikasi`,
		);
	const parsed = parseBrief(task.brief);
	const cek = parsed.ok ? parsed.brief.cek : [];
	const edit = task.mode === "edit";

	const git = gitInfo(task.repo);
	let pelanggaran: string | undefined;
	if (task.headSha && git.head && task.headSha !== git.head)
		pelanggaran = `HEAD berubah (${pendek(task.headSha)}→${pendek(git.head)})`;
	else if (task.branch && git.branch && task.branch !== git.branch)
		pelanggaran = `branch berubah (${task.branch}→${git.branch})`;

	const perubahan = edit ? computeChanges(ledger, task, task.repo) : [];
	const hasilCek = runChecks(cek, task.repo, options.waktuCekMs);
	const hasil: VerifyResult = {
		ok: !pelanggaran && hasilCek.every((c) => c.ok),
		pelanggaran,
		perubahan,
		plus: perubahan.reduce((n, f) => n + f.plus, 0),
		minus: perubahan.reduce((n, f) => n + f.minus, 0),
		luarCakupan: edit ? outsideScope(ledger, task, task.repo) : [],
		cek: hasilCek,
		tanpaPaham: edit && !task.paham,
		linha: "",
	};
	hasil.linha = formatLine(task, hasil);

	const status = pelanggaran ? "pelanggaran" : hasil.ok ? "selesai" : "gagal";
	ledger.patch(id, { verify: JSON.stringify(hasil) });
	ledger.setStatus(id, status);
	ledger.addEvent(id, status, hasil.linha);
	return hasil;
}
