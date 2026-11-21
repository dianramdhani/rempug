import type { Transport } from "./transport.js";

export interface BangunOpsi {
	transport: Transport;
	/** Pane orkestrator (`sesi:window.pane`). */
	target: string;
	baris: string;
	/** Jeda antara dua pengambilan layar untuk memastikan pane idle. */
	jedaMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cadangan bila tool Monitor tidak ada: mengetik satu baris ke pane orkestrator, hanya saat pane itu idle
 * (layar tidak berubah), supaya tidak bercampur dengan ketikan atau keluaran yang sedang berjalan.
 */
export async function bangunkan(opsi: BangunOpsi): Promise<boolean> {
	const { transport, target } = opsi;
	try {
		// Perbandingan mentah, bukan hashLayar: untuk menyuntik teks, timer yang berjalan pun berarti pane sibuk.
		const awal = transport.tampak(target).baris.join("\n");
		await sleep(opsi.jedaMs ?? 400);
		const akhir = transport.tampak(target).baris.join("\n");
		if (awal !== akhir) return false;
		await transport.kirim(target, `[rempug] ${opsi.baris}`);
		return true;
	} catch {
		return false;
	}
}
