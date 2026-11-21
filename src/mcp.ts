import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { type Ctx, run } from "./commands.js";
import { UsageError } from "./core/errors.js";

type Dasar = Omit<Ctx, "io">;

interface Perintah {
	argv: string[];
	stdin?: string;
}

/** Menjalankan perintah CLI yang setara dan membungkus keluarannya sebagai hasil tool. */
async function panggil(dasar: Dasar, { argv, stdin }: Perintah) {
	const out: string[] = [];
	const err: string[] = [];
	const kode = await run(argv, {
		...dasar,
		io: {
			stdout: (teks) => void out.push(teks),
			stderr: (teks) => void err.push(teks),
			stdin: async () => {
				if (stdin === undefined)
					throw new UsageError("perintah ini membutuhkan isi teks");
				return stdin;
			},
		},
	});
	const teks = [...out, ...err].join("\n") || "(kosong)";
	return {
		content: [{ type: "text" as const, text: teks }],
		isError: kode !== 0,
	};
}

const bendera = (nama: string, nilai: boolean | undefined) =>
	nilai ? [`--${nama}`] : [];
const opsi = (nama: string, nilai: string | number | undefined) =>
	nilai === undefined ? [] : [`--${nama}`, String(nilai)];

/**
 * Server MCP: pembungkus tipis di atas perintah CLI yang sama, jadi perilakunya identik.
 * `watch` sengaja tidak diekspos karena panjang umur; ia dijalankan lewat Monitor dari CLI.
 */
export async function jalankanMcp(dasar: Dasar, versi: string): Promise<void> {
	const server = new McpServer({ name: "rempug", version: versi });
	const id = z.number().int().positive().describe("ID tugas, mis. 12");

	// Tipe kondisional registerTool tidak dapat diselesaikan untuk skema bergenerik, jadi pendaftaran dipersempit
	// di satu titik ini; tiap tool tetap bertipe ketat lewat parameter `bangun`.
	const daftar = server.registerTool.bind(server) as unknown as (
		nama: string,
		konfigurasi: { description: string; inputSchema: z.ZodRawShape },
		pemanggil: (a: Record<string, unknown>) => ReturnType<typeof panggil>,
	) => unknown;

	function alat<S extends z.ZodRawShape>(
		nama: string,
		deskripsi: string,
		masukan: S,
		bangun: (a: z.infer<z.ZodObject<S>>) => Perintah,
	) {
		daftar(nama, { description: deskripsi, inputSchema: masukan }, (a) =>
			panggil(dasar, bangun(a as z.infer<z.ZodObject<S>>)),
		);
	}

	alat(
		"scan",
		"Pindai pane tmux dan beri skor kandidat agent (JSON).",
		{},
		() => ({ argv: ["scan"] }),
	);
	alat(
		"register",
		"Daftarkan agent dari pane tmux lalu probe cara mengirimnya; mengembalikan status kesiapan.",
		{
			nama: z.string().describe("nama pendek, mis. codex"),
			target: z.string().describe("sesi:window.pane, dari scan"),
			jenis: z.string().optional(),
			kemampuan: z.array(z.string()).optional().describe("mis. playwright"),
			tanpaProbe: z.boolean().optional(),
		},
		(a) => ({
			argv: [
				"register",
				a.nama,
				"--target",
				a.target,
				...opsi("jenis", a.jenis),
				...opsi("kemampuan", a.kemampuan?.join(",")),
				...bendera("tanpa-probe", a.tanpaProbe),
			],
		}),
	);
	alat(
		"probe",
		"Ukur ulang cara mengirim ke agent. `profil` (JSON) menguji satu profil usulan.",
		{ nama: z.string(), profil: z.string().optional() },
		(a) => ({ argv: ["probe", a.nama, ...opsi("profil", a.profil)] }),
	);
	alat(
		"ls",
		"Daftar agent: status siap/sibuk/hilang/tidak-andal, kemampuan, tugas aktif.",
		{},
		() => ({ argv: ["ls"] }),
	);
	alat(
		"status",
		"Satu baris kondisi agent; membersihkan agent yang sesinya hilang.",
		{},
		() => ({ argv: ["status"] }),
	);
	alat(
		"send",
		"Kirim tugas ke agent. Brief wajib memuat TUJUAN, CAKUPAN (edit <path...>|baca|browser), LANGKAH bernomor, CEK, BALASAN. Kembali segera dengan ID.",
		{
			agent: z.string(),
			brief: z.string().describe("teks brief berlabel"),
			queue: z.boolean().optional().describe("antre bila agent sibuk"),
			after: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("tunggu tugas ini selesai dulu"),
			teliti: z.boolean().optional().describe("selalu tinjau rencana agent"),
			centang: z
				.string()
				.optional()
				.describe("berkas#nomor tasks.md yang dicentang bila lulus"),
		},
		(a) => ({
			argv: [
				"send",
				a.agent,
				...bendera("queue", a.queue),
				...opsi("after", a.after),
				...bendera("teliti", a.teliti),
				...opsi("centang", a.centang),
			],
			stdin: a.brief,
		}),
	);
	alat(
		"brief",
		"Baca teks tugas (untuk agent); ini menandai brief diterima.",
		{ id },
		(a) => ({ argv: ["brief", String(a.id)] }),
	);
	alat(
		"paham",
		"Konfirmasi pemahaman tugas edit sebelum bekerja (CAKUPAN, CEK, RENCANA, ASUMSI, PERTANYAAN).",
		{ id, isi: z.string() },
		(a) => ({ argv: ["paham", String(a.id)], stdin: a.isi }),
	);
	alat(
		"tunggu",
		"Tunggu jawaban klarifikasi; ulangi sampai LANJUT.",
		{ id },
		(a) => ({ argv: ["tunggu", String(a.id)] }),
	);
	alat(
		"jawab",
		"Jawab klarifikasi atau pertanyaan agent.",
		{ id, teks: z.string() },
		(a) => ({ argv: ["jawab", String(a.id)], stdin: a.teks }),
	);
	alat(
		"reply",
		"Balas tugas (HASIL, BUKTI, BLOCKER) dan mulai verifikasi; gagal=true bila tidak bisa menyelesaikan.",
		{ id, isi: z.string(), gagal: z.boolean().optional() },
		(a) => ({
			argv: ["reply", String(a.id), ...bendera("gagal", a.gagal)],
			stdin: a.isi,
		}),
	);
	alat(
		"log",
		"Satu baris per tugas di repo ini.",
		{ n: z.number().int().positive().optional() },
		(a) => ({
			argv: ["log", ...opsi("n", a.n)],
		}),
	);
	alat(
		"show",
		"Ringkasan satu tugas; penuh=true menambah brief, balasan lengkap, dan perubahan.",
		{ id, penuh: z.boolean().optional() },
		(a) => ({
			argv: ["show", String(a.id), ...bendera("penuh", a.penuh)],
		}),
	);
	alat(
		"diff",
		"Daftar file yang berubah, atau hunk satu file bila `berkas` diberikan.",
		{ id, berkas: z.string().optional() },
		(a) => ({
			argv: ["diff", String(a.id), ...(a.berkas ? [a.berkas] : [])],
		}),
	);
	alat(
		"report",
		"Laporan pekerjaan. Untuk menjawab MANUSIA selalu manusia=true (kalimat biasa tanpa ID atau simbol); tanpa itu keluarannya hanya untuk orkestrator. md menulis berkas Markdown.",
		{ md: z.string().optional(), manusia: z.boolean().optional() },
		(a) => ({
			argv: ["report", ...opsi("md", a.md), ...bendera("manusia", a.manusia)],
		}),
	);
	alat(
		"layar",
		"Layar mentah pane agent; hanya bila benar-benar perlu.",
		{ agent: z.string(), baris: z.number().int().positive().optional() },
		(a) => ({
			argv: ["layar", a.agent, ...opsi("baris", a.baris)],
		}),
	);
	alat(
		"terima",
		"Ambil kejadian yang belum disampaikan (saat watch tidak berjalan).",
		{},
		() => ({ argv: ["terima"] }),
	);

	const tutup = new Promise<void>((resolve) => {
		server.server.onclose = resolve;
	});
	await server.connect(new StdioServerTransport());
	await tutup;
}
