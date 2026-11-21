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

const POTONG = 140;

const potong = (teks: string) =>
	teks.length > POTONG ? `${teks.slice(0, POTONG - 1)}…` : teks;

/** Baris pertama balasan agent tanpa label "HASIL:", dalam kata-kata agent sendiri. */
function inti(teks: string | undefined): string | undefined {
	const baris = (teks ?? "")
		.split("\n")
		.map((l) => l.trim().replace(/^(HASIL|RINGKASAN)\s*:\s*/i, ""))
		.find(Boolean);
	return baris ? potong(baris) : undefined;
}

function uraianPerubahan(hasil: VerifyResult): string {
	const per = (st: string) =>
		hasil.perubahan.filter((f) => f.status === st).length;
	const bagian = [
		[per("M"), (n: number) => `mengubah ${n} berkas`],
		[per("A"), (n: number) => `menambah ${n} berkas baru`],
		[per("D"), (n: number) => `menghapus ${n} berkas`],
	]
		.filter(([n]) => (n as number) > 0)
		.map(([n, f]) => (f as (n: number) => string)(n as number));
	if (bagian.length === 0) return "tidak ada berkas yang berubah";
	const kalimat =
		bagian.length === 1
			? (bagian[0] as string)
			: `${bagian.slice(0, -1).join(", ")}, dan ${bagian.at(-1)}`;
	const garis =
		hasil.plus > 0 || hasil.minus > 0
			? ` (${hasil.plus} baris ditambah, ${hasil.minus} dihapus)`
			: "";
	return `${kalimat}${garis}`;
}

function uraianCek(hasil: VerifyResult): string | undefined {
	if (hasil.cek.length === 0) return undefined;
	const gagal = hasil.cek.filter((c) => !c.ok);
	if (gagal.length === 0) return "semua pengecekan lulus";
	return gagal
		.map((c) =>
			c.timeout
				? `pengecekan ${c.label} melewati batas waktu`
				: c.gagal
					? `pengecekan ${c.label} gagal (${c.gagal} masalah)`
					: `pengecekan ${c.label} gagal`,
		)
		.join(", ");
}

function uraianTugas(task: Task): string {
	const hasil = hasilVerifikasi(task);
	switch (task.status) {
		case "selesai": {
			if (task.mode !== "edit") return inti(task.replySummary) ?? "selesai";
			const bagian = hasil
				? [uraianPerubahan(hasil), uraianCek(hasil)]
				: ["selesai"];
			if (hasil?.peringatan)
				bagian.push(
					"juga ada commit lain di repo selama tugas berjalan (bukan dari tugas ini)",
				);
			if (hasil?.luarCakupan.length)
				bagian.push(
					`juga ada perubahan di luar area tugas: ${hasil.luarCakupan.slice(0, 4).join(", ")}`,
				);
			return bagian.filter(Boolean).join("; ");
		}
		case "gagal":
			return (
				(hasil && uraianCek(hasil)) ||
				inti(task.replySummary) ||
				"tidak berhasil"
			);
		case "pelanggaran":
			return "mengubah riwayat git tanpa izin (membuat commit atau berpindah cabang); hasilnya tidak dipercaya";
		case "gagal-paham":
			return "tidak memahami tugas setelah beberapa kali klarifikasi";
		case "macet":
			return "terhenti dan tidak merespons";
		case "menunggu-klarifikasi":
			return "menunggu jawaban atas pertanyaannya";
		case "antri":
			return "menunggu giliran";
		default:
			if (task.flag === "menunggu-izin")
				return `menunggu persetujuan Anda di sesi ${task.agent}`;
			if (task.flag === "bertanya")
				return "mengajukan pertanyaan dan menunggu jawaban";
			if (task.flag === "diterima-tanpa-ack")
				return "menerima tugas tetapi belum mulai bekerja";
			return "sedang dikerjakan";
	}
}

function tujuanTugas(task: Task): string {
	const tujuan = /^TUJUAN:[ \t]*(.+)$/m.exec(task.brief)?.[1]?.trim();
	return tujuan ? tujuan.replace(/\s+/g, " ") : "tugas tanpa judul";
}

/**
 * Laporan dalam kalimat biasa untuk manusia: tanpa ID tugas, simbol, atau istilah internal.
 * Hanya nama agent (yang diberikan pengguna sendiri) dan kata-kata agent yang dipertahankan.
 */
export function formatLaporanManusia(tasks: Task[]): string {
	if (tasks.length === 0) return "Belum ada pekerjaan yang didelegasikan.";
	const k = kelompok(tasks);
	const bermasalah = [...new Set([...k.gagal, ...k.blocker])];
	const berjalan = k.berjalan.filter((t) => !bermasalah.includes(t));
	const bagian: string[] = [];
	const tulis = (judul: string, daftar: Task[]) => {
		if (daftar.length === 0) return;
		const baris = daftar
			.slice(0, MAKS_PER_KELOMPOK)
			.map((t) => `- ${tujuanTugas(t)} (oleh ${t.agent}): ${uraianTugas(t)}`);
		if (daftar.length > MAKS_PER_KELOMPOK)
			baris.push(`- dan ${daftar.length - MAKS_PER_KELOMPOK} lainnya`);
		bagian.push(`${judul} (${daftar.length})\n${baris.join("\n")}`);
	};
	tulis("Selesai", k.selesai);
	tulis("Sedang berjalan", berjalan);
	tulis("Perlu perhatian", bermasalah);
	return bagian.join("\n\n");
}
