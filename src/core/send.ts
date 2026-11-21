import { type AgentRow, agentRows, requireAvailable } from "./agents.js";
import { parseBrief } from "./brief.js";
import { RempugError, UsageError } from "./errors.js";
import { gitInfo } from "./git.js";
import type { Ledger, Task, TaskStatus } from "./ledger.js";
import { PROFIL_BAWAAN } from "./profile.js";
import { claimConflicts, formatConflict } from "./scope.js";
import type { TmuxOpts } from "./tmux.js";
import type { Transport } from "./transport.js";

/** Nama konsumen kejadian milik orkestrator. */
export const KONSUMEN = "orkestrator";

/** `watch` dianggap hidup bila terlihat dalam rentang ini (detik). */
const WATCH_HIDUP_DETIK = 10;

/** Status tugas yang tidak akan pernah selesai; tugas yang menunggunya dibatalkan. */
const TIDAK_SELESAI: readonly TaskStatus[] = [
	"gagal",
	"gagal-paham",
	"pelanggaran",
	"macet",
	"bentrok",
];

export interface SendDeps {
	ledger: Ledger;
	registryFile: string;
	repo: string;
	transport: Transport;
	tmux?: TmuxOpts;
	/** Dipanggil sebelum tugas dikirim ke agent (mis. snapshot berkas); galatnya menggagalkan tugas. */
	siapkan?: (task: Task) => void | Promise<void>;
}

export interface SendInput {
	agent: string;
	brief: string;
	queue?: boolean;
	afterId?: number;
	teliti?: boolean;
	centang?: string;
}

export interface SendResult {
	id: number;
	status: "berjalan" | "antri";
	peringatan?: string;
}

/** Satu baris yang diketik ke TUI agent; seluruh isi tugas dibaca lewat `rempug brief`. */
export function pointer(id: number): string {
	return `Tugas T${id}: jalankan \`rempug brief T${id}\`, kerjakan persis isinya, lalu balas dengan \`rempug reply T${id}\` (isi lewat stdin). Dilarang git commit, push, reset, checkout, stash.`;
}

function peringatanWatch(ledger: Ledger): string | undefined {
	const seen = ledger.getConsumer(KONSUMEN)?.lastSeen;
	if (seen !== undefined && ledger.now() - seen <= WATCH_HIDUP_DETIK)
		return undefined;
	return "peringatan: `rempug watch` belum aktif; pasang lewat Monitor (timeout maksimum) sebelum menunggu hasil.";
}

async function deliver(
	deps: SendDeps,
	task: Task,
	row: AgentRow,
): Promise<void> {
	const { ledger } = deps;
	try {
		await deps.siapkan?.(task);
		ledger.setStatus(task.id, "berjalan");
		ledger.patch(task.id, { scrHash: null, scrSince: ledger.now() });
		await deps.transport.kirim(
			row.tmux,
			pointer(task.id),
			row.kirim ?? PROFIL_BAWAAN,
		);
	} catch (error) {
		const pesan = (error as Error).message;
		ledger.setStatus(task.id, "gagal");
		ledger.addEvent(
			task.id,
			"gagal",
			`T${task.id} ${task.agent} ✗ pengiriman gagal: ${pesan}`,
		);
		throw new RempugError(`pengiriman T${task.id} gagal: ${pesan}`);
	}
}

/** Membuat tugas, lalu mengirimnya ke agent atau mengantrekannya; kembali segera tanpa menunggu agent. */
export async function sendTask(
	deps: SendDeps,
	input: SendInput,
): Promise<SendResult> {
	const { ledger, repo } = deps;
	const parsed = parseBrief(input.brief);
	if (!parsed.ok)
		throw new UsageError(
			`brief tidak lengkap:\n${parsed.errors.map((e) => `- ${e}`).join("\n")}`,
		);
	const { cakupan } = parsed.brief;
	const scope = cakupan.mode === "edit" ? cakupan.paths : undefined;

	const row = requireAvailable(
		agentRows(deps.registryFile, ledger, deps.tmux),
		input.agent,
	);
	let menungguTugas = false;
	if (input.afterId !== undefined) {
		const sebelum = ledger.getTask(input.afterId);
		if (!sebelum || sebelum.repo !== repo)
			throw new UsageError(
				`--after T${input.afterId}: tugas tidak ada di repo ini`,
			);
		if (TIDAK_SELESAI.includes(sebelum.status))
			throw new UsageError(
				`--after T${sebelum.id}: tugas itu sudah ${sebelum.status}`,
			);
		menungguTugas = sebelum.status !== "selesai";
	}
	const antri = input.queue === true || input.afterId !== undefined;
	if (row.status === "sibuk" && !antri)
		throw new RempugError(
			`agent "${row.name}" sibuk (T${row.tugas}); pakai --queue untuk mengantre`,
		);
	const menunggu = menungguTugas || (row.status === "sibuk" && antri);

	// Bentrok cakupan dicek saat benar-benar akan dikirim; tugas antrean dicek ulang oleh pump.
	if (!menunggu) {
		const konflik = claimConflicts(ledger, repo, { mode: cakupan.mode, scope });
		if (konflik.length > 0)
			throw new RempugError(konflik.map(formatConflict).join("\n"));
	}

	const git = gitInfo(repo);
	const id = ledger.createTask({
		repo,
		agent: row.name,
		mode: cakupan.mode,
		scope,
		brief: input.brief,
		afterId: input.afterId,
		headSha: git.head,
		branch: git.branch,
		porcelain: git.porcelain,
		teliti: input.teliti,
		centang: input.centang,
	});
	// Kursor awal = kejadian terakhir saat ini, supaya konsumen baru hanya menerima kejadian sesudah tugas ini.
	ledger.ensureConsumer(KONSUMEN, ledger.maxEventId(repo));
	const peringatan = peringatanWatch(ledger);

	if (menunggu) return { id, status: "antri", peringatan };
	await deliver(deps, ledger.getTask(id) as Task, row);
	return { id, status: "berjalan", peringatan };
}

/**
 * Mengirim tugas antrean yang sudah boleh jalan (agent bebas, tugas `--after` selesai,
 * tidak bentrok). Mengembalikan ID tugas yang dikirim.
 */
export async function pump(deps: SendDeps): Promise<number[]> {
	const { ledger, repo } = deps;
	const terkirim: number[] = [];
	for (const task of ledger.tasksWhere(repo, ["antri"])) {
		const batal = (alasan: string) => {
			ledger.setStatus(task.id, "gagal");
			ledger.addEvent(
				task.id,
				"dibatalkan",
				`T${task.id} ${task.agent} dibatalkan: ${alasan}`,
			);
		};
		if (task.afterId !== undefined) {
			const sebelum = ledger.getTask(task.afterId);
			if (sebelum && TIDAK_SELESAI.includes(sebelum.status)) {
				batal(`T${sebelum.id} ${sebelum.status}`);
				continue;
			}
			if (sebelum && sebelum.status !== "selesai") continue;
		}
		const row = agentRows(deps.registryFile, ledger, deps.tmux).find(
			(r) => r.name === task.agent,
		);
		if (!row || row.status === "hilang") {
			batal(`agent ${task.agent} hilang`);
			continue;
		}
		if (row.status !== "siap") continue;
		if (
			claimConflicts(ledger, repo, { mode: task.mode, scope: task.scope })
				.length > 0
		)
			continue;
		await deliver(deps, task, row);
		terkirim.push(task.id);
	}
	return terkirim;
}

/** Teks tugas untuk agent; membaca ini menandai brief sudah diterima (ack). */
export function readBrief(ledger: Ledger, id: number): string {
	const task = ledger.getTask(id);
	if (!task) throw new RempugError(`tugas T${id} tidak ada`);
	ledger.markAcked(id);
	const edit = task.mode === "edit";
	const langkah = [
		...(edit
			? [
					`Sebelum mengubah file, jalankan \`rempug paham T${id}\` (isi lewat stdin) dengan bagian berlabel:
   CAKUPAN: <sama dengan brief>
   CEK: <sama dengan brief>
   RENCANA: maksimal 3 butir
   ASUMSI: (tulis - bila tidak ada)
   PERTANYAAN: (tulis - bila tidak ada)
   Bila hasilnya "LANJUT", mulai bekerja. Bila "MENUNGGU", jalankan \`rempug tunggu T${id}\` dan ulangi sampai "LANJUT".`,
				]
			: []),
		"Kerjakan langkah-langkah di atas persis sesuai isinya.",
		`Setelah selesai, balas dengan \`rempug reply T${id}\` (isi lewat stdin): HASIL, BUKTI, BLOCKER. Bila tidak bisa menyelesaikan: \`rempug reply T${id} --gagal\`.`,
	];
	return [
		`TUGAS T${id} (${task.mode}) untuk repo ${task.repo}`,
		"ATURAN: kerjakan PERSIS isi tugas. Dilarang git commit, push, reset, checkout, stash. Jangan menyentuh file di luar CAKUPAN.",
		"",
		task.brief.trim(),
		"",
		"PROTOKOL:",
		...langkah.map((l, i) => `${i + 1}. ${l}`),
	].join("\n");
}
