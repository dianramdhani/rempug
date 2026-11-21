/** Cara mengirim satu baris ke TUI sebuah agent; diukur lewat probe, bukan ditebak. */
export interface Profil {
	/** `keys`: `send-keys -l`; `paste`: bracketed paste lewat buffer tmux. */
	suntik: "keys" | "paste";
	/** Tombol yang ditekan sebelum teks, mis. `C-u` untuk membersihkan kotak input. */
	sebelum: string[];
	/** Tombol pengirim; `["Enter", "Enter"]` untuk TUI yang menelan Enter pertama. */
	submit: string[];
	/** Jeda antara menyuntik teks dan menekan submit. */
	jeda_ms: number;
}

export const PROFIL_BAWAAN: Profil = {
	suntik: "keys",
	sebelum: [],
	submit: ["Enter"],
	jeda_ms: 400,
};

/** Kombinasi yang dicoba berurutan saat probe; urutan dari yang paling umum. */
export const KANDIDAT: Profil[] = [
	PROFIL_BAWAAN,
	{ suntik: "paste", sebelum: [], submit: ["Enter"], jeda_ms: 400 },
	{ suntik: "keys", sebelum: ["C-u"], submit: ["Enter"], jeda_ms: 400 },
	{
		suntik: "keys",
		sebelum: ["C-u"],
		submit: ["Enter", "Enter"],
		jeda_ms: 600,
	},
	{ suntik: "paste", sebelum: ["C-u"], submit: ["Enter"], jeda_ms: 600 },
	{
		suntik: "paste",
		sebelum: ["Escape", "C-u"],
		submit: ["Enter"],
		jeda_ms: 1000,
	},
	{
		suntik: "keys",
		sebelum: ["Escape", "C-u"],
		submit: ["Enter", "Enter"],
		jeda_ms: 1000,
	},
];
