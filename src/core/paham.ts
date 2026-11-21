import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseBrief } from "./brief.js";
import { RempugError, UsageError } from "./errors.js";
import type { Ledger, Task } from "./ledger.js";
import { PROFIL_BAWAAN } from "./profile.js";
import { readAgents } from "./registry.js";
import { covers } from "./scope.js";
import { parseSections } from "./sections.js";
import type { TmuxOpts } from "./tmux.js";
import type { Transport } from "./transport.js";

const LABELS = ["CAKUPAN", "CEK", "RENCANA", "ASUMSI", "PERTANYAAN"] as const;
const MAKS_PUTARAN = 3;
const MAKS_BUTIR = 3;

/** Tindakan yang tidak boleh muncul di rencana agent. */
const TERLARANG =
	/\bgit\s+(commit|push|reset|checkout|stash|rebase|clean|merge|cherry-pick)\b|\brm\s+-[a-z]*r[a-z]*\b|\bsudo\b|--force\b|--no-verify\b/i;

export type PahamHasil =
	| { hasil: "LANJUT" }
	| { hasil: "MENUNGGU"; alasan: string }
	| { hasil: "GAGAL-PAHAM" };

const kosong = (teks: string | undefined) =>
	!teks || /^(-|\(kosong\)|tidak ada)$/i.test(teks.trim());

const normalisasi = (path: string) =>
	path.replace(/^(\.\/)+/, "").replace(/\/+$/, "");

function sama(a: string[], b: string[]): boolean {
	const x = [...new Set(a)].sort();
	const y = [...new Set(b)].sort();
	return x.length === y.length && x.every((v, i) => v === y[i]);
}

const baris = (teks: string) =>
	teks
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

/** Kata kerja yang mengubah isi berkas. Menyebut berkas untuk dibaca atau diperiksa tidak dihitung. */
const KATA_TULIS =
	/\b(ubah|mengubah|diubah|edit|mengedit|diedit|tulis|menulis|ditulis|hapus|menghapus|dihapus|buat|membuat|dibuat|tambah|menambah|menambahkan|ditambah|ganti|mengganti|diganti|rename|pindah|memindahkan|dipindah|modifikasi|memodifikasi|perbarui|memperbarui|update|write|create|delete|remove|modify|change|replace|overwrite|move|patch|append)\b/i;

/**
 * Memecah rencana menjadi butir: per baris, dan per penomoran dalam satu baris ("1) a 2) b 3) c").
 * Model murah sering menulis seluruh rencana dalam satu baris.
 */
function butirRencana(teks: string): string[] {
	return teks
		.split("\n")
		.flatMap((l) => l.split(/(?:^|\s)\d+[.)]\s+/))
		.map((b) => b.trim().replace(/^[-*•]\s+/, ""))
		.filter(Boolean);
}

/** `a/{b,c}/d` menjadi `a/b/d` dan `a/c/d`. */
function kembangkanKurung(token: string): string[] {
	const cocok = /\{([^{}]*)\}/.exec(token);
	if (!cocok) return [token];
	const depan = token.slice(0, cocok.index);
	const belakang = token.slice(cocok.index + cocok[0].length);
	return (cocok[1] ?? "")
		.split(",")
		.flatMap((pilihan) =>
			kembangkanKurung(`${depan}${pilihan.trim()}${belakang}`),
		);
}

/**
 * Path yang disebut di teks. Token dianggap path bila berekstensi, atau memuat `/` dan benar-benar ada di repo.
 * Kata biasa seperti "laporan/checkpoint" atau "docs" tidak dihitung; yang terlewat tertangkap oleh
 * pemeriksaan perubahan nyata setelah tugas selesai.
 */
function pathDisebut(teks: string, repo: string): string[] {
	return teks
		.split(/[\s`'"()]+/)
		.flatMap(kembangkanKurung)
		.flatMap((t) => t.split(/[,;:]+/))
		.map((t) => t.replace(/\.+$/, ""))
		.filter(
			(t) =>
				t !== "" &&
				!t.startsWith("-") &&
				!t.startsWith("*") &&
				!t.includes("://") &&
				(/\.[a-z][a-z0-9]{1,4}$/i.test(t) ||
					(t.includes("/") && existsSync(join(repo, t)))),
		);
}

/** Perintah tanpa penghias: tanpa backtick, bullet, nomor, atau prompt `$`, dengan spasi dirapikan. */
const bersihkanPerintah = (teks: string) =>
	teks
		.replace(/`/g, "")
		.replace(/^\s*(?:\d+[.)]|[-*•]|\$)\s+/, "")
		.replace(/\s+/g, " ")
		.trim();

/** Perintah brief yang tidak disebut di CEK agent; urutan, format, dan perintah tambahan dari agent diabaikan. */
function cekYangHilang(
	cekAgent: string | undefined,
	cekBrief: string[],
): string[] {
	const tumpukan = kosong(cekAgent)
		? ""
		: (cekAgent ?? "").split("\n").map(bersihkanPerintah).join("\n");
	return cekBrief.filter(
		(perintah) => !tumpukan.includes(bersihkanPerintah(perintah)),
	);
}

const potong = (teks: string, panjang: number) =>
	teks.length > panjang ? `${teks.slice(0, panjang - 1)}…` : teks;

/** Alasan konfirmasi pemahaman tidak boleh disetujui otomatis; kosong berarti cocok. */
function bandingkan(
	task: Task,
	bagian: Map<string, string>,
): { alasan: string[]; rencana: string[] } {
	const parsed = parseBrief(task.brief);
	if (!parsed.ok || parsed.brief.cakupan.mode !== "edit")
		throw new RempugError(`brief T${task.id} tersimpan tidak valid`);
	const scope = parsed.brief.cakupan.paths;
	const alasan: string[] = [];

	const cakupan = (bagian.get("CAKUPAN") ?? "").split(/[\s,]+/).filter(Boolean);
	if (cakupan[0] === "edit") cakupan.shift();
	if (!sama(cakupan.map(normalisasi), scope.map(normalisasi)))
		alasan.push(
			`cakupan berbeda dari brief (agent: ${cakupan.join(", ") || "-"}; brief: ${scope.join(", ")})`,
		);

	const hilang = cekYangHilang(bagian.get("CEK"), parsed.brief.cek);
	if (hilang.length > 0)
		alasan.push(`cek berbeda dari brief (tidak disebut: ${hilang.join(", ")})`);

	const rencanaTeks = bagian.get("RENCANA") ?? "";
	const rencana = butirRencana(rencanaTeks);
	if (rencana.length > MAKS_BUTIR)
		alasan.push(`rencana lebih dari ${MAKS_BUTIR} butir (${rencana.length})`);
	// Hanya butir yang menulis yang dibatasi cakupan; membaca berkas di luar cakupan itu wajar (mis. audit).
	const luar = [
		...new Set(
			rencana
				.filter((butir) => KATA_TULIS.test(butir))
				.flatMap((butir) => pathDisebut(butir, task.repo))
				.filter((p) => !covers(scope, p)),
		),
	];
	if (luar.length > 0)
		alasan.push(`rencana menyentuh di luar cakupan: ${luar.join(", ")}`);
	const terlarang = TERLARANG.exec(
		`${rencanaTeks}\n${bagian.get("ASUMSI") ?? ""}`,
	);
	if (terlarang)
		alasan.push(`rencana memuat tindakan terlarang: ${terlarang[0]}`);

	if (!kosong(bagian.get("ASUMSI")))
		alasan.push(`asumsi: ${bagian.get("ASUMSI")}`);
	if (!kosong(bagian.get("PERTANYAAN")))
		alasan.push(`pertanyaan: ${bagian.get("PERTANYAAN")}`);
	return { alasan, rencana };
}

/**
 * Konfirmasi pemahaman dari agent. Disetujui otomatis (tanpa token orkestrator) bila isinya
 * cocok dengan brief; selain itu tugas ditahan dan satu kejadian dikeluarkan.
 */
export function paham(ledger: Ledger, id: number, teks: string): PahamHasil {
	const task = ledger.getTask(id);
	if (!task) throw new RempugError(`tugas T${id} tidak ada`);
	if (task.status !== "berjalan" && task.status !== "menunggu-klarifikasi")
		throw new RempugError(
			`tugas T${id} berstatus ${task.status}; paham tidak berlaku`,
		);
	if (task.mode !== "edit") {
		ledger.patch(id, { paham: teks });
		return { hasil: "LANJUT" };
	}

	const { body, errors } = parseSections(teks, LABELS);
	for (const label of LABELS)
		if (!body.has(label)) errors.push(`bagian ${label} hilang`);
	if (errors.length > 0)
		throw new UsageError(
			`format paham salah:\n${errors.map((e) => `- ${e}`).join("\n")}`,
		);

	const { alasan, rencana } = bandingkan(task, body);
	if (task.teliti) alasan.push(`--teliti, rencana: ${rencana.join(" / ")}`);
	if (alasan.length === 0) {
		ledger.patch(id, { paham: teks });
		return { hasil: "LANJUT" };
	}

	const putaran = task.putaran + 1;
	if (putaran > MAKS_PUTARAN) {
		ledger.setStatus(id, "gagal-paham");
		ledger.addEvent(
			id,
			"gagal-paham",
			`T${id} ${task.agent} ✗ gagal-paham setelah ${MAKS_PUTARAN} putaran klarifikasi`,
		);
		return { hasil: "GAGAL-PAHAM" };
	}
	ledger.patch(id, { paham: teks, putaran });
	ledger.setStatus(id, "menunggu-klarifikasi");
	const ringkas = alasan.join("; ").replace(/\s*\n\s*/g, " ");
	ledger.addEvent(
		id,
		"klarifikasi",
		potong(`T${id} ${task.agent} menunggu-klarifikasi: ${ringkas}`, 300),
	);
	return { hasil: "MENUNGGU", alasan: ringkas };
}

export interface JawabDeps {
	ledger: Ledger;
	registryFile: string;
	transport: Transport;
	tmux?: TmuxOpts;
}

/**
 * Jawaban orkestrator. Bila tugas menunggu klarifikasi, jawaban disimpan untuk diambil agent
 * lewat `tunggu`; bila agent bertanya di obrolan (tugas berjalan), teksnya disuntikkan ke agent.
 */
export async function jawab(
	deps: JawabDeps,
	id: number,
	teks: string,
): Promise<"disimpan" | "dikirim"> {
	const task = deps.ledger.getTask(id);
	if (!task) throw new RempugError(`tugas T${id} tidak ada`);
	if (task.status === "menunggu-klarifikasi") {
		deps.ledger.patch(id, { jawaban: teks });
		return "disimpan";
	}
	if (task.status === "berjalan") {
		const agent = readAgents(deps.registryFile).find(
			(a) => a.name === task.agent,
		);
		if (!agent) throw new RempugError(`agent "${task.agent}" tidak terdaftar`);
		await deps.transport.kirim(agent.tmux, teks, agent.kirim ?? PROFIL_BAWAAN);
		return "dikirim";
	}
	throw new RempugError(
		`tugas T${id} berstatus ${task.status}; tidak ada yang dijawab`,
	);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Agent menunggu jawaban; menahan paling lama `timeoutMs` dan aman diulang. */
export async function tunggu(
	ledger: Ledger,
	id: number,
	options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<string> {
	const { timeoutMs = 45_000, pollMs = 500 } = options;
	const akhir = Date.now() + timeoutMs;
	for (;;) {
		const task = ledger.getTask(id);
		if (!task) throw new RempugError(`tugas T${id} tidak ada`);
		if (task.status === "berjalan") return "LANJUT";
		if (task.status === "gagal-paham")
			return `GAGAL-PAHAM: batas klarifikasi terlampaui; berhenti dan jalankan \`rempug reply T${id} --gagal\`.`;
		if (task.status !== "menunggu-klarifikasi")
			return `STOP: tugas berstatus ${task.status}.`;
		if (task.jawaban) {
			ledger.setStatus(id, "berjalan");
			ledger.patch(id, { jawaban: null });
			return `JAWABAN: ${task.jawaban}\nLANJUT`;
		}
		if (Date.now() >= akhir)
			return `BELUM: belum ada jawaban; jalankan \`rempug tunggu T${id}\` lagi.`;
		await sleep(pollMs);
	}
}
