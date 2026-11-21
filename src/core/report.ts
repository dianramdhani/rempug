import type { Task } from "./ledger.js";
import type { VerifyResult } from "./verify.js";

const MAKS_PER_KELOMPOK = 10;

function hasilVerifikasi(task: Task): VerifyResult | undefined {
	return task.verify ? (JSON.parse(task.verify) as VerifyResult) : undefined;
}

const indent = (teks: string) =>
	teks
		.split("\n")
		.map((l) => `  ${l}`)
		.join("\n");

/** Satu baris per tugas: hasil verifikasi bila ada, selain itu status singkat. */
export function barisLog(task: Task): string {
	const hasil = hasilVerifikasi(task);
	if (hasil) return hasil.linha;
	const kepala = `T${task.id} ${task.agent}`;
	if (task.status === "gagal") {
		const alasan = (task.replySummary ?? "").split("\n")[0] ?? "";
		return alasan ? `${kepala} ✗ gagal: ${alasan}` : `${kepala} ✗ gagal`;
	}
	return task.flag
		? `${kepala} ${task.status} (${task.flag})`
		: `${kepala} ${task.status}`;
}

/** Ringkasan satu tugas; `penuh` menambah brief, balasan lengkap, daftar perubahan, dan ekor cek yang gagal. */
export function formatShow(task: Task, penuh: boolean): string {
	const bagian = [
		`T${task.id} ${task.agent} ${task.status} (${task.mode})`,
		barisLog(task),
	];
	if (task.replySummary)
		bagian.push(`ringkasan:\n${indent(task.replySummary)}`);
	if (!penuh) return bagian.join("\n");

	bagian.push(`brief:\n${indent(task.brief.trim())}`);
	if (task.replyDetail)
		bagian.push(`balasan lengkap:\n${indent(task.replyDetail)}`);
	const hasil = hasilVerifikasi(task);
	if (hasil?.perubahan.length)
		bagian.push(
			`perubahan:\n${indent(hasil.perubahan.map((f) => `${f.status} ${f.path} +${f.plus}/−${f.minus}${f.biner ? " (biner)" : ""}`).join("\n"))}`,
		);
	for (const cek of hasil?.cek ?? [])
		if (!cek.ok) bagian.push(`cek gagal ${cek.label}:\n${indent(cek.ekor)}`);
	return bagian.join("\n");
}

const SELESAI = ["selesai"];
const GAGAL = ["gagal", "gagal-paham", "pelanggaran", "bentrok"];
const BLOCKER_STATUS = [
	"macet",
	"menunggu-klarifikasi",
	"pelanggaran",
	"gagal-paham",
];
const BLOCKER_FLAG = ["menunggu-izin", "bertanya", "diterima-tanpa-ack"];

function kelompok(tasks: Task[]) {
	return {
		selesai: tasks.filter((t) => SELESAI.includes(t.status)),
		berjalan: tasks.filter(
			(t) =>
				t.status === "berjalan" ||
				t.status === "memverifikasi" ||
				t.status === "antri",
		),
		gagal: tasks.filter((t) => GAGAL.includes(t.status)),
		blocker: tasks.filter(
			(t) =>
				BLOCKER_STATUS.includes(t.status) ||
				(t.status === "berjalan" &&
					t.flag !== undefined &&
					BLOCKER_FLAG.includes(t.flag)),
		),
	};
}

/** Laporan teks ringkas per repo: selesai, berjalan, gagal, dan blocker; daftar panjang dipotong. */
export function formatLaporan(repo: string, tasks: Task[]): string {
	if (tasks.length === 0) return `laporan rempug ${repo}\nbelum ada tugas`;
	const k = kelompok(tasks);
	const bagian = [`laporan rempug ${repo}`];
	for (const [nama, daftar] of Object.entries(k)) {
		if (daftar.length === 0) continue;
		const baris = daftar
			.slice(0, MAKS_PER_KELOMPOK)
			.map((t) => `  ${barisLog(t)}`);
		if (daftar.length > MAKS_PER_KELOMPOK)
			baris.push(`  +${daftar.length - MAKS_PER_KELOMPOK} lagi`);
		bagian.push(`${nama} (${daftar.length})\n${baris.join("\n")}`);
	}
	return bagian.join("\n");
}

export function formatLaporanMd(repo: string, tasks: Task[]): string {
	const k = kelompok(tasks);
	const bagian = [`# Laporan rempug\n\nRepo: \`${repo}\``];
	for (const [nama, daftar] of Object.entries(k)) {
		if (daftar.length === 0) continue;
		const judul = nama[0]?.toUpperCase() + nama.slice(1);
		bagian.push(
			`## ${judul} (${daftar.length})\n\n${daftar.map((t) => `- ${barisLog(t)}`).join("\n")}`,
		);
	}
	if (tasks.length === 0) bagian.push("Belum ada tugas.");
	return `${bagian.join("\n\n")}\n`;
}
