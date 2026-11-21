import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { RempugError } from "./errors.js";
import type { Ledger } from "./ledger.js";
import { KANDIDAT, type Profil } from "./profile.js";
import { type Agent, readAgents, updateAgent } from "./registry.js";
import { klasifikasi, tokenDiLayar } from "./screen.js";
import { pointer } from "./send.js";
import { listPanes, type TmuxOpts } from "./tmux.js";
import type { Transport } from "./transport.js";

export interface ProbeDeps {
	ledger: Ledger;
	registryFile: string;
	transport: Transport;
	tmux?: TmuxOpts;
	repo: string;
	/** Kombinasi yang dicoba berurutan; bawaannya `KANDIDAT`. */
	kandidat?: Profil[];
	ackTimeoutMs?: number;
	baselineMs?: number;
	/** Pembaca versi CLI agent; bawaannya menjalankan `<jenis> --version`. */
	versi?: (jenis: string) => string | undefined;
}

export type ProbeStatus = "siap" | "tidak-andal" | "perlu-izin" | "tanpa-ack";

export interface ProbeHasil {
	nama: string;
	status: ProbeStatus;
	profil?: Profil;
	ackMs?: number;
	dicoba: number;
	catatan?: string;
	/** Layar terakhir yang dibatasi, untuk diagnosis adaptif oleh orkestrator. */
	cuplikan?: string;
}

const BRIEF_PING =
	"TUJUAN: probe pengiriman\nCAKUPAN: baca\nLANGKAH:\n1. Tidak perlu melakukan apa pun selain membaca tugas ini.\nCEK: -\nBALASAN: -";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sha1 = (teks: string) => createHash("sha1").update(teks).digest("hex");

/** Versi CLI agent (baris pertama `--version`), atau kosong bila tidak bisa dibaca. */
export function versiAgent(jenis: string): string | undefined {
	const hasil = spawnSync(jenis, ["--version"], {
		encoding: "utf8",
		timeout: 3000,
	});
	if (hasil.error || hasil.status !== 0) return undefined;
	return hasil.stdout
		.split("\n")
		.find((l) => l.trim() !== "")
		?.trim();
}

async function tungguAck(
	ledger: Ledger,
	id: number,
	batasMs: number,
): Promise<boolean> {
	const akhir = Date.now() + batasMs;
	while (Date.now() < akhir) {
		if (ledger.getTask(id)?.ackedAt !== undefined) return true;
		await sleep(40);
	}
	return ledger.getTask(id)?.ackedAt !== undefined;
}

const cuplik = (baris: string[]) =>
	baris
		.map((b) => b.trimEnd())
		.filter(Boolean)
		.slice(-30)
		.join("\n");

/**
 * Mengukur cara berkomunikasi dengan satu agent: teknik kirim yang benar-benar sampai (diuji lewat
 * tugas `ping` yang harus dibaca agent), waktu ack, dan apakah layarnya beranimasi saat idle.
 * Hasilnya disimpan di registry. Tidak pernah menjawab prompt izin atas nama user.
 */
export async function probeAgent(
	deps: ProbeDeps,
	nama: string,
): Promise<ProbeHasil> {
	const { ledger, transport } = deps;
	const agent = readAgents(deps.registryFile).find((a) => a.name === nama);
	if (!agent) throw new RempugError(`agent "${nama}" tidak terdaftar`);
	if (!listPanes(deps.tmux).some((p) => p.target === agent.tmux))
		throw new RempugError(
			`pane ${agent.tmux} milik agent "${nama}" tidak ada di tmux`,
		);

	const kandidat = deps.kandidat ?? KANDIDAT;
	const ackTimeout = deps.ackTimeoutMs ?? 12_000;
	const baseline = deps.baselineMs ?? 1500;

	const hash = new Set<string>();
	for (let i = 0; i < 4; i++) {
		hash.add(sha1(transport.tampak(agent.tmux).baris.join("\n")));
		await sleep(baseline / 4);
	}
	const animasiIdle = hash.size > 1;
	const versi = (deps.versi ?? versiAgent)(agent.kind) ?? agent.versi;

	let dicoba = 0;
	let alasan: "tertahan" | "dibuang" | undefined;
	let hasil: ProbeHasil | undefined;
	let layarAkhir: string[] = [];

	for (const profil of kandidat) {
		dicoba++;
		const id = ledger.createTask({
			repo: deps.repo,
			agent: nama,
			mode: "baca",
			brief: BRIEF_PING,
		});
		ledger.setStatus(id, "berjalan");
		const mulai = Date.now();
		try {
			await transport.kirim(agent.tmux, pointer(id), profil);
			if (await tungguAck(ledger, id, ackTimeout)) {
				const ackMs = Date.now() - mulai;
				await sleep(Math.min(1500, baseline));
				const baris = transport
					.tampak(agent.tmux)
					.baris.filter((b) => b.trim() !== "");
				const penandaSiap = /^\s*([^\p{L}\p{N}\s]{1,4})/u.exec(
					baris.at(-1) ?? "",
				)?.[1];
				hasil = { nama, status: "siap", profil, ackMs, dicoba };
				updateAgent(deps.registryFile, nama, {
					kirim: profil,
					tidakAndal: false,
					versi,
					gagalBeruntun: 0,
					ukur: { ackMs, animasiIdle, penandaSiap, probeAt: ledger.now() },
				});
				return hasil;
			}
			const { baris, kursorY } = transport.tampak(agent.tmux);
			layarAkhir = baris;
			const token = `rempug brief T${id}`;
			const keadaan = klasifikasi({ baris, kursorY, berubah: false, token });
			if (keadaan === "menunggu-izin") {
				hasil = {
					nama,
					status: "perlu-izin",
					dicoba,
					catatan: `agent menunggu izin menjalankan rempug: setujui sekali di sesi ${agent.tmux} (pilih izinkan selalu), lalu ulangi /rempug`,
				};
				break;
			}
			if (keadaan === "error") {
				hasil = {
					nama,
					status: "tidak-andal",
					dicoba,
					catatan: "batas pemakaian agent tercapai; coba lagi nanti",
				};
				break;
			}
			if (keadaan === "tertahan") alasan = "tertahan";
			else if (tokenDiLayar(baris, token)) {
				// Teks ada di riwayat percakapan: agent menerimanya, jadi tidak boleh dikirim ulang.
				hasil = {
					nama,
					status: "tanpa-ack",
					dicoba,
					catatan:
						"pointer diterima tetapi agent tidak menjalankan rempug (kemungkinan menunggu izin atau tidak mengikuti protokol)",
				};
				break;
			} else alasan = "dibuang";
			await transport.tekan(agent.tmux, ["C-u"]);
		} finally {
			ledger.deleteTask(id);
		}
	}

	hasil ??= {
		nama,
		status: "tidak-andal",
		dicoba,
		catatan:
			alasan === "tertahan"
				? `teks tertahan di kotak input; ${dicoba} kombinasi dicoba`
				: `teks tidak pernah muncul di layar; ${dicoba} kombinasi dicoba`,
	};
	hasil.cuplikan = cuplik(layarAkhir);
	if (hasil.status !== "perlu-izin")
		updateAgent(deps.registryFile, nama, {
			tidakAndal: true,
			versi,
			ukur: { ...agent.ukur, animasiIdle, probeAt: ledger.now() },
		});
	return hasil;
}

/** Profil usang bila versi CLI agent berubah atau pengiriman gagal berturut-turut dua kali. */
export function isStale(
	agent: Agent,
	versiSekarang: string | undefined,
): boolean {
	if ((agent.gagalBeruntun ?? 0) >= 2) return true;
	return (
		agent.versi !== undefined &&
		versiSekarang !== undefined &&
		agent.versi !== versiSekarang
	);
}

/** Memprobe ulang agent hanya bila profilnya usang; mengembalikan `undefined` bila tidak perlu. */
export async function reprobeJikaUsang(
	deps: ProbeDeps,
	nama: string,
	versiSekarang: string | undefined,
): Promise<ProbeHasil | undefined> {
	const agent = readAgents(deps.registryFile).find((a) => a.name === nama);
	if (!agent || !isStale(agent, versiSekarang)) return undefined;
	return probeAgent(deps, nama);
}
