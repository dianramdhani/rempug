import type { Ledger, LedgerEvent } from "./ledger.js";
import { KONSUMEN } from "./send.js";

export function kejadianTertunda(
	ledger: Ledger,
	repo: string,
	konsumen: string = KONSUMEN,
): LedgerEvent[] {
	const kursor = ledger.getConsumer(konsumen)?.lastEventId;
	return kursor === undefined ? [] : ledger.eventsAfter(kursor, repo);
}

/** Satu baris penanda bila ada kejadian yang belum disampaikan; ditempel di awal keluaran perintah lain. */
export function penandaTertunda(
	ledger: Ledger,
	repo: string,
	konsumen: string = KONSUMEN,
): string | undefined {
	const n = kejadianTertunda(ledger, repo, konsumen).length;
	return n > 0
		? `[${n} kejadian belum disampaikan: jalankan \`rempug terima\`]`
		: undefined;
}

/** Mengambil kejadian tertunda dan memajukan kursor; dipakai saat `watch` tidak berjalan. */
export function terima(
	ledger: Ledger,
	repo: string,
	konsumen: string = KONSUMEN,
): string[] {
	const baru = kejadianTertunda(ledger, repo, konsumen);
	for (const e of baru) ledger.advanceConsumer(konsumen, e.id);
	return baru.map((e) => e.line);
}

export interface WatchOptions {
	ledger: Ledger;
	repo: string;
	konsumen?: string;
	/** Dipanggil sekali per kejadian, tepat satu baris. */
	tulis: (baris: string) => void;
	sinyal?: AbortSignal;
	intervalMs?: number;
	/** Dijalankan tiap putaran, mis. pemantau layar. */
	tiapSiklus?: () => void | Promise<void>;
}

function tidur(ms: number, sinyal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const selesai = () => {
			clearTimeout(timer);
			sinyal?.removeEventListener("abort", selesai);
			resolve();
		};
		const timer = setTimeout(selesai, ms);
		sinyal?.addEventListener("abort", selesai, { once: true });
	});
}

/**
 * Mencetak satu baris per kejadian sampai dihentikan. Kursor disimpan per konsumen, jadi `watch`
 * yang dipasang ulang menerima dulu semua yang terlewat. Konsumen baru hanya menerima kejadian
 * sesudah ia mulai. Tidak mencetak apa pun saat sepi, karena tiap baris menjadi satu notifikasi.
 */
export async function watch(opsi: WatchOptions): Promise<void> {
	const { ledger, repo, konsumen = KONSUMEN, tulis, sinyal } = opsi;
	ledger.ensureConsumer(konsumen, ledger.maxEventId(repo));
	while (!sinyal?.aborted) {
		const baru = kejadianTertunda(ledger, repo, konsumen);
		for (const e of baru) {
			tulis(e.line);
			// Maju setelah menulis: bila proses mati di antaranya, kejadian dikirim ulang, bukan hilang.
			ledger.advanceConsumer(konsumen, e.id);
		}
		if (baru.length === 0) ledger.touchConsumer(konsumen);
		await opsi.tiapSiklus?.();
		await tidur(opsi.intervalMs ?? 1000, sinyal);
	}
}
