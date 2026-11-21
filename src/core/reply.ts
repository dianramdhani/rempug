import { RempugError } from "./errors.js";
import type { Ledger, TaskStatus } from "./ledger.js";

/** Status tempat balasan agent masih diterima. */
const BISA_DIBALAS: readonly TaskStatus[] = [
	"berjalan",
	"menunggu-klarifikasi",
	"macet",
];

const RINGKASAN_BARIS = 12;
const RINGKASAN_LEBAR = 200;

/** Baris tidak kosong pertama, dibatasi jumlah dan lebarnya; detail lengkap tetap tersimpan terpisah. */
function ringkas(teks: string): string {
	return teks
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.slice(0, RINGKASAN_BARIS)
		.map((l) =>
			l.length > RINGKASAN_LEBAR ? `${l.slice(0, RINGKASAN_LEBAR - 1)}…` : l,
		)
		.join("\n");
}

export interface ReplyOptions {
	gagal?: boolean;
	/** Memicu verifikasi di proses terlepas supaya agent tidak terblokir. */
	spawnVerify: (id: number) => void;
}

/** Menyimpan balasan agent dan memulai verifikasi (atau menandai gagal bila `--gagal`). */
export function reply(
	ledger: Ledger,
	id: number,
	teks: string,
	options: ReplyOptions,
): { status: TaskStatus } {
	const task = ledger.getTask(id);
	if (!task) throw new RempugError(`tugas T${id} tidak ada`);
	if (!BISA_DIBALAS.includes(task.status))
		throw new RempugError(
			`tugas T${id} berstatus ${task.status}; balasan ditolak`,
		);

	const ringkasan = ringkas(teks);
	ledger.saveReply(id, ringkasan, teks);
	if (options.gagal) {
		ledger.setStatus(id, "gagal");
		const alasan = (ringkasan.split("\n")[0] ?? "").slice(0, 120);
		ledger.addEvent(id, "gagal", `T${id} ${task.agent} ✗ gagal: ${alasan}`);
		return { status: "gagal" };
	}
	ledger.setStatus(id, "memverifikasi");
	options.spawnVerify(id);
	return { status: "memverifikasi" };
}
