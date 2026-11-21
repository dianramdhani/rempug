import { createHash } from "node:crypto";

export type Keadaan =
	| "tertahan"
	| "menunggu-izin"
	| "error"
	| "bertanya"
	| "siap"
	| "bekerja";

const POLA_IZIN = [
	/\b(allow|approve|permit|authorize)\b[^\n]{0,80}\?/i,
	/\(y\/n\)/i,
	/\[y\/n\]/i,
	/press enter to (continue|confirm|approve)/i,
	/do you want to (proceed|run|allow|make this edit|create)/i,
	/izinkan/i,
	// Dialog yang muncul saat agent pertama kali dibuka di sebuah folder.
	/do you trust|trust (this|the|these) (folder|project|contents|workspace|directory)/i,
];

const POLA_LIMIT = [
	/rate limit|usage limit|quota (exceeded|reached)|limit (reached|exceeded)/i,
	/hit your (usage )?limit|too many requests|\b429\b|credit balance|out of credits/i,
	// Galat autentikasi: agent tidak bisa memanggil modelnya, sama buntunya dengan kehabisan kuota.
	/token refresh failed|\b401\b|unauthorized|authentication (failed|error)|invalid api key|not logged in|log ?in again|login required/i,
];

/**
 * Tanda bahwa agent sedang bekerja walau layarnya tampak diam. Divalidasi dengan codex 0.171 dan
 * Antigravity 1.5 asli yang menjalankan perintah 70 detik: timer berdetik (angka) tidak dihitung sebagai
 * perubahan layar, dan Antigravity memindahkan perintah panjang ke latar belakang (tanpa "esc to cancel").
 * Kata biasa seperti "Working" atau "3 tasks" di riwayat sengaja tidak cocok: polanya meminta bentuk lengkapnya.
 */
const POLA_SIBUK = [
	/esc to (interrupt|cancel)/i, // codex dan Antigravity saat berpikir atau menjalankan
	/background terminal running/i, // codex
	/\bWorking \(\d/, // codex: "Working (45s • esc to interrupt)"
	/^\s*●\s*\[\d{1,2}:\d{2}:\d{2}\].*\brunning\b/im, // Antigravity: tugas latar belakang
	/·\s*\d+ tasks?/i, // Antigravity: footer "· 1 task(s" selama ada tugas latar belakang
	/[\u2800-\u28ff]\s+(Working|Running|Thinking)/i, // Antigravity: spinner dengan kata kerja
];

/** Jumlah baris terakhir yang dianggap "saat ini"; yang lebih atas adalah riwayat. */
const BARIS_AKHIR = 8;

/** Baris di atas kursor yang masih dianggap bagian kotak input (input yang terbungkus beberapa baris). */
const BARIS_INPUT = 2;

const squash = (teks: string) => teks.replace(/\s+/g, "");
const tidakKosong = (baris: string[]) =>
	baris.map((b) => b.trimEnd()).filter((b) => b.trim() !== "");
const bersih = (baris: string) => baris.replace(/^[\s│┃|]+|[\s│┃|]+$/g, "");

/** Mengabaikan spinner, angka (timer), dan spasi, sehingga hanya perubahan teks yang dihitung sebagai kemajuan. */
export function normalisasi(teks: string): string {
	return teks
		.replace(/[⠀-⣿✻✶✳✢·●○◐◓◑◒⏺|/\\-]/g, "")
		.replace(/\d+/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function hashLayar(teks: string): string {
	return createHash("sha1").update(normalisasi(teks)).digest("hex");
}

/** Apakah `token` (mis. `rempug brief T12`) ada di layar; spasi diabaikan karena baris bisa terbungkus. */
export function tokenDiLayar(baris: string[], token: string): boolean {
	return squash(baris.join("")).includes(squash(token));
}

/** Pertanyaan terakhir agent dalam beberapa baris terakhir, tanpa garis kotak; kosong bila tidak ada. */
export function pertanyaan(baris: string[]): string | undefined {
	const kandidat = tidakKosong(baris)
		.slice(-BARIS_AKHIR)
		.map(bersih)
		.filter((b) => b.endsWith("?"));
	const terakhir = kandidat.at(-1);
	if (terakhir === undefined) return undefined;
	return terakhir.length > 200 ? `${terakhir.slice(0, 199)}…` : terakhir;
}

/** Teks tertahan di kotak input: token ada di baris kursor atau beberapa baris di atasnya. */
function tertahan(
	baris: string[],
	kursorY: number | undefined,
	token: string,
): boolean {
	if (kursorY === undefined)
		return tokenDiLayar(tidakKosong(baris).slice(-3), token);
	return tokenDiLayar(
		baris.slice(Math.max(0, kursorY - BARIS_INPUT), kursorY + 1),
		token,
	);
}

export interface KlasifikasiInput {
	/** Baris yang tampak di pane. */
	baris: string[];
	/** Baris tempat kursor berada; membedakan teks di kotak input dari yang bergema di riwayat. */
	kursorY?: number;
	/** Layar baru saja berubah; selama itu agent dianggap bekerja. */
	berubah: boolean;
	/**
	 * Jumlah baris tak kosong terakhir yang dibaca (bawaan 8). Sempit dengan sengaja: riwayat lama di atas layar
	 * bukan keadaan saat ini. Probe membaca layar yang masih baru, dan tata letak dua kolom seperti opencode
	 * menaruh pesan galat belasan baris di atas dasar layar, jadi probe memakai jendela yang lebar.
	 */
	jendela?: number;
	/** Penanda unik pointer tugas, mis. `rempug brief T12`. */
	token?: string;
	polaIzin?: string[];
	polaLimit?: string[];
}

/** Menggolongkan layar secara mekanis; tidak memakai token model sama sekali. */
export function klasifikasi(masuk: KlasifikasiInput): Keadaan {
	if (masuk.berubah) return "bekerja";
	const akhir = tidakKosong(masuk.baris)
		.slice(-(masuk.jendela ?? BARIS_AKHIR))
		.join("\n");
	const tambahan = (pola: string[] | undefined) =>
		(pola ?? []).map((p) => new RegExp(p, "i"));
	if ([...POLA_LIMIT, ...tambahan(masuk.polaLimit)].some((p) => p.test(akhir)))
		return "error";
	if ([...POLA_IZIN, ...tambahan(masuk.polaIzin)].some((p) => p.test(akhir)))
		return "menunggu-izin";
	// Setelah izin dan limit (dialog izin juga memuat "esc to cancel"), sebelum teks tertahan: agent yang sedang
	// bekerja tidak boleh dikirimi ulang atau diingatkan.
	if (POLA_SIBUK.some((p) => p.test(akhir))) return "bekerja";
	const token = masuk.token;
	if (token && tertahan(masuk.baris, masuk.kursorY, token)) return "tertahan";
	const tanpaPointer = token
		? masuk.baris.filter((b) => !squash(b).includes(squash(token)))
		: masuk.baris;
	return pertanyaan(tanpaPointer) ? "bertanya" : "siap";
}
