import { PROFIL_BAWAAN, type Profil } from "./profile.js";
import { runTmux, type TmuxOpts } from "./tmux.js";

/** Antarmuka pengiriman ke agent; hanya tmux yang ada, mode headless dapat ditambah kemudian. */
export interface Transport {
	/** Menyuntik satu baris ke agent dan mengirimkannya sesuai profil. */
	kirim(target: string, baris: string, profil?: Profil): Promise<void>;
	/** Menekan tombol tanpa teks (mis. mengulang submit). */
	tekan(target: string, keys: string[]): Promise<void>;
	/** Isi layar pane (`baris` terakhir). */
	layar(target: string, baris?: number): string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function tmuxTransport(opts: TmuxOpts = {}): Transport {
	// "=" memaksa pencocokan nama sesi persis; tanpanya sesi bernama "1" dibaca sebagai nomor pane.
	const tujuan = (target: string) => `=${target}`;
	const run = (args: string[], input?: string) => {
		const result = runTmux(args, opts, input);
		if (result.status !== 0)
			throw new Error(
				`tmux ${args[0]} gagal: ${result.stderr.trim() || result.error?.message || "tidak diketahui"}`,
			);
	};
	const tekan = async (target: string, keys: string[]) => {
		for (const key of keys) run(["send-keys", "-t", tujuan(target), key]);
	};
	return {
		tekan,
		async kirim(target, baris, profil = PROFIL_BAWAAN) {
			await tekan(target, profil.sebelum);
			if (profil.suntik === "keys")
				run(["send-keys", "-t", tujuan(target), "-l", baris]);
			else {
				const buffer = `rempug-${process.pid}`;
				run(["load-buffer", "-b", buffer, "-"], baris);
				run(["paste-buffer", "-p", "-d", "-b", buffer, "-t", tujuan(target)]);
			}
			await sleep(profil.jeda_ms);
			await tekan(target, profil.submit);
		},
		layar(target, baris = 40) {
			const result = runTmux(
				["capture-pane", "-p", "-t", tujuan(target), "-S", `-${baris}`],
				opts,
			);
			if (result.status !== 0)
				throw new Error(`tmux capture-pane gagal: ${result.stderr.trim()}`);
			return result.stdout;
		},
	};
}
