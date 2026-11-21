import type { Ledger, Task } from "./ledger.js";
import { PROFIL_BAWAAN } from "./profile.js";
import { type Agent, readAgents, updateAgent } from "./registry.js";
import { hashLayar, klasifikasi, pertanyaan } from "./screen.js";
import { pointer } from "./send.js";
import { listPanes, type TmuxOpts } from "./tmux.js";
import type { Transport } from "./transport.js";

export interface TickOpsi {
	/** Batas tunggu ack sebelum pengiriman dianggap bermasalah (detik). */
	ackDetik: number;
	/** Layar yang tidak berubah selama ini dianggap diam (detik). */
	diamDetik: number;
	/** Layar diam selama ini tanpa balasan berarti macet (detik). */
	macetDetik: number;
	/** Jumlah percobaan ulang pengiriman sebelum tersangkut. */
	maksUpaya: number;
}

export const TICK_BAWAAN: TickOpsi = {
	ackDetik: 45,
	diamDetik: 10,
	macetDetik: 120,
	maksUpaya: 3,
};

export interface TickDeps {
	ledger: Ledger;
	repo: string;
	registryFile: string;
	transport: Transport;
	tmux?: TmuxOpts;
	opsi?: Partial<TickOpsi>;
}

/**
 * Satu putaran pemantauan layar untuk tugas yang sedang berjalan: mengulang pengiriman yang
 * tertahan, melaporkan pertanyaan, izin, limit, dan agent yang diam. Seluruhnya mekanis;
 * orkestrator baru terlibat saat sebuah kejadian dikeluarkan. Mengembalikan baris kejadian baru.
 */
export async function tick(deps: TickDeps): Promise<string[]> {
	const o = { ...TICK_BAWAAN, ...deps.opsi };
	const { ledger, transport } = deps;
	const keluar: string[] = [];
	const panes = new Set(listPanes(deps.tmux).map((p) => p.target));

	for (const task of ledger.tasksWhere(deps.repo, ["berjalan"])) {
		const agent = readAgents(deps.registryFile).find(
			(a) => a.name === task.agent,
		);
		const emit = (kind: string, line: string, status?: "macet") => {
			ledger.addEvent(task.id, kind, line);
			if (status) ledger.setStatus(task.id, status);
			keluar.push(line);
		};
		const kepala = `T${task.id} ${task.agent}`;

		let tampak: ReturnType<Transport["tampak"]> | undefined;
		if (agent && panes.has(agent.tmux)) {
			try {
				tampak = transport.tampak(agent.tmux);
			} catch {
				tampak = undefined;
			}
		}
		if (!agent || !tampak) {
			emit("macet", `${kepala} macet: agent hilang`, "macet");
			continue;
		}
		await reaksi(task, agent, tampak);

		async function reaksi(
			t: Task,
			a: Agent,
			layar: NonNullable<typeof tampak>,
		) {
			const sekarang = ledger.now();
			const hash = hashLayar(layar.baris.join("\n"));
			let sejak = t.scrSince ?? sekarang;
			let flag = t.flag;
			if (t.scrHash === undefined)
				ledger.patch(t.id, { scrHash: hash, scrSince: sejak });
			else if (t.scrHash !== hash) {
				sejak = sekarang;
				flag = undefined;
				ledger.patch(t.id, { scrHash: hash, scrSince: sejak, flag: null });
			}
			const diam = sekarang - sejak;
			const sekali = (kind: string, line: string, status?: "macet") => {
				if (flag === kind) return;
				flag = kind;
				ledger.patch(t.id, { flag: kind });
				emit(kind, line, status);
			};

			const token = `rempug brief T${t.id}`;
			const keadaan = klasifikasi({
				baris: layar.baris,
				kursorY: layar.kursorY,
				berubah: diam < o.diamDetik,
				token,
			});
			if (keadaan === "bekerja") return;

			const batasAck = Math.max(o.ackDetik, ((a.ukur?.ackMs ?? 0) / 1000) * 3);
			if (!t.ackedAt && sekarang - t.sentAt < batasAck) return;

			if (keadaan === "menunggu-izin")
				return sekali(
					"menunggu-izin",
					`${kepala} menunggu-izin: butuh persetujuan manusia di sesi ${a.tmux}`,
				);
			if (keadaan === "error")
				return sekali(
					"limit",
					`${kepala} limit: agent melaporkan galat limit, kuota, atau autentikasi; lihat layar agent`,
					"macet",
				);
			if (keadaan === "bertanya")
				return sekali(
					"bertanya",
					`${kepala} bertanya: ${pertanyaan(layar.baris) ?? "?"} | jawab: rempug jawab T${t.id} "<teks>"`,
				);

			if (!t.ackedAt) {
				if (keadaan === "tertahan") return tertahanAck(t, a);
				return sekali(
					"diterima-tanpa-ack",
					`${kepala} diterima-tanpa-ack: pointer terkirim tetapi agent belum menjalankan rempug; dugaan: tidak mengikuti protokol atau berpikir lama`,
				);
			}

			// Sudah ack, layar diam, tidak ada pertanyaan atau izin: agent kemungkinan selesai tanpa membalas.
			if (t.pengingat === 0) {
				if (diam < o.diamDetik * 2) return;
				await transport.kirim(
					a.tmux,
					`Pengingat: tugas T${t.id} belum dibalas. Jalankan \`rempug reply T${t.id}\` (isi lewat stdin) bila sudah selesai.`,
					a.kirim ?? PROFIL_BAWAAN,
				);
				ledger.patch(t.id, { pengingat: 1, scrSince: sekarang });
				return;
			}
			if (diam >= o.macetDetik)
				emit(
					"macet",
					`${kepala} macet: layar diam ${diam} dtk setelah pengingat, tanpa balasan`,
					"macet",
				);
		}

		async function tertahanAck(t: Task, a: Agent) {
			if (t.upaya >= o.maksUpaya) {
				updateAgent(deps.registryFile, a.name, {
					gagalBeruntun: (a.gagalBeruntun ?? 0) + 1,
				});
				return emit(
					"tersangkut",
					`${kepala} tersangkut: pointer tertahan di kotak input setelah ${o.maksUpaya} percobaan`,
					"macet",
				);
			}
			const profil = a.kirim ?? PROFIL_BAWAAN;
			ledger.patch(t.id, { upaya: t.upaya + 1, scrSince: ledger.now() });
			if (t.upaya + 1 < o.maksUpaya)
				await transport.tekan(a.tmux, profil.submit);
			else
				await transport.kirim(a.tmux, pointer(t.id), {
					...profil,
					sebelum: ["C-u"],
					submit: ["Enter", "Enter"],
				});
		}
	}
	return keluar;
}
