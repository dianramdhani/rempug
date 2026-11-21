import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { agentRows, formatAgentRow, register } from "./core/agents.js";
import { bangunkan } from "./core/bangun.js";
import { centangItem } from "./core/centang.js";
import { defaultDoctorDeps, formatDoctor, runDoctor } from "./core/doctor.js";
import { RempugError, UsageError } from "./core/errors.js";
import { repoRoot } from "./core/git.js";
import { Ledger, ledgerPath, retentionDays } from "./core/ledger.js";
import { jawab, paham, tunggu } from "./core/paham.js";
import {
	formatProbe,
	isStale,
	type ProbeDeps,
	probeAgent,
	versiAgent,
} from "./core/probe.js";
import {
	readAgents,
	registryPath,
	removeAgent,
	updateAgent,
} from "./core/registry.js";
import { reply } from "./core/reply.js";
import {
	barisLog,
	formatLaporan,
	formatLaporanMd,
	formatShow,
} from "./core/report.js";
import { scan } from "./core/scan.js";
import {
	KONSUMEN,
	pump,
	readBrief,
	type SendDeps,
	sendTask,
} from "./core/send.js";
import { type TickOpsi, tick } from "./core/tick.js";
import { listPanes, type TmuxOpts } from "./core/tmux.js";
import { type Transport, tmuxTransport } from "./core/transport.js";
import {
	computeChanges,
	takeSnapshot,
	unifiedDiff,
	verifyTask,
} from "./core/verify.js";
import { penandaTertunda, terima, watch } from "./core/watch.js";

export interface Io {
	stdout(teks: string): void;
	stderr(teks: string): void;
	/** Seluruh isi stdin; galat bila stdin adalah terminal. */
	stdin(): Promise<string>;
}

export interface Ctx {
	env: Record<string, string | undefined>;
	cwd: string;
	io: Io;
	tmux?: TmuxOpts;
	transport?: Transport;
	/** Memicu `_verify` di proses terlepas; bawaannya `rempug _verify <id>` yang dilepas. */
	spawnVerify?: (id: number) => void;
	/** Menimpa pengaturan probe (untuk uji). */
	probe?: Partial<ProbeDeps>;
	/** Pembaca versi CLI agent; bawaannya menjalankan `<jenis> --version`. */
	versi?: (jenis: string) => string | undefined;
	sinyal?: AbortSignal;
	/** Selang `watch` dalam ms. */
	watchMs?: number;
	/** `watch` menjalankan pemantau layar setiap sekian putaran. */
	tickSetiap?: number;
	tickOpsi?: Partial<TickOpsi>;
}

const USAGE = `rempug: distribusi kerja dari agent orkestrator ke agent CLI lain lewat tmux.

Untuk orkestrator:
  scan | register <nama> --target T [--jenis J] [--kemampuan a,b] [--tanpa-probe]
  probe <nama> [--profil JSON] | ls | doctor | status
  send <agent> [--queue] [--after N] [--teliti] [--centang berkas#nomor]   (brief dari stdin)
  log [--n 20] | show <id> [--penuh] | diff <id> [berkas] | report [--md berkas]
  jawab <id> [teks] | layar <agent> [--baris N] | watch [--konsumen N] | terima
Untuk agent:
  brief <id> | paham <id> | tunggu <id> | reply <id> [--gagal]
Lainnya: --version`;

/** Nilai kembali berupa kode keluar; selain angka dianggap 0. */
type Handler = (args: string[], h: H) => unknown;

interface H {
	readonly ledger: Ledger;
	repo: string;
	registryFile: string;
	transport: Transport;
	ctx: Ctx;
	io: Io;
}

function argumen<T extends Record<string, { type: "string" | "boolean" }>>(
	args: string[],
	options: T,
) {
	try {
		return parseArgs({ args, options, allowPositionals: true });
	} catch (error) {
		throw new UsageError((error as Error).message);
	}
}

function idDari(teks: string | undefined): number {
	const n = Number(String(teks ?? "").replace(/^T/i, ""));
	if (!Number.isInteger(n) || n <= 0)
		throw new UsageError(
			`ID tugas tidak valid: "${teks ?? ""}" (contoh: 12 atau T12)`,
		);
	return n;
}

function sendDeps(h: H): SendDeps {
	return {
		ledger: h.ledger,
		registryFile: h.registryFile,
		repo: h.repo,
		transport: h.transport,
		tmux: h.ctx.tmux,
		siapkan: (task) => {
			if (task.mode === "edit") takeSnapshot(h.ledger, task, task.repo);
		},
	};
}

function probeDeps(h: H): ProbeDeps {
	return {
		ledger: h.ledger,
		registryFile: h.registryFile,
		transport: h.transport,
		tmux: h.ctx.tmux,
		repo: h.repo,
		versi: h.ctx.versi,
		...h.ctx.probe,
	};
}

function spawnVerifyBawaan(ctx: Ctx, id: number): void {
	const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
	spawn(process.execPath, [cli, "_verify", String(id)], {
		detached: true,
		stdio: "ignore",
		cwd: ctx.cwd,
		env: ctx.env as NodeJS.ProcessEnv,
	}).unref();
}

const kerjakan = (h: H, id: number) => {
	const task = h.ledger.getTask(id);
	if (!task) throw new RempugError(`tugas T${id} tidak ada`);
	return task;
};

const HANDLERS: Record<string, Handler> = {
	scan(_args, h) {
		h.io.stdout(JSON.stringify(scan(h.repo, { tmux: h.ctx.tmux })));
	},

	async register(args, h) {
		const { values, positionals } = argumen(args, {
			target: { type: "string" },
			jenis: { type: "string" },
			kemampuan: { type: "string" },
			"tanpa-probe": { type: "boolean" },
		});
		const [nama] = positionals;
		if (!nama || !values.target)
			throw new UsageError(
				"pemakaian: rempug register <nama> --target <sesi:window.pane> [--jenis J] [--kemampuan a,b] [--tanpa-probe]",
			);
		register(
			h.registryFile,
			{
				name: nama,
				kind: values.jenis ?? nama,
				tmux: values.target,
				capabilities: (values.kemampuan ?? "")
					.split(",")
					.map((k) => k.trim())
					.filter(Boolean),
			},
			h.ctx.tmux,
		);
		if (values["tanpa-probe"])
			return void h.io.stdout(`${nama} terdaftar (belum diprobe)`);
		h.io.stdout(formatProbe(await probeAgent(probeDeps(h), nama)));
	},

	async probe(args, h) {
		const { values, positionals } = argumen(args, {
			profil: { type: "string" },
		});
		const [nama] = positionals;
		if (!nama)
			throw new UsageError("pemakaian: rempug probe <nama> [--profil JSON]");
		let kandidat: ProbeDeps["kandidat"];
		if (values.profil) {
			try {
				kandidat = [JSON.parse(values.profil)];
			} catch {
				throw new UsageError("--profil harus berupa JSON profil pengiriman");
			}
		}
		h.io.stdout(
			formatProbe(
				await probeAgent(
					{ ...probeDeps(h), ...(kandidat ? { kandidat } : {}) },
					nama,
				),
			),
		);
	},

	async ls(_args, h) {
		const kons = h.ledger.getConsumer(KONSUMEN);
		const hidup =
			kons?.lastSeen !== undefined && h.ledger.now() - kons.lastSeen <= 10;
		// Tanpa watch yang berjalan, pemeriksaan layar dilakukan di sini agar agent macet tetap terdeteksi.
		if (!hidup)
			await tick({
				ledger: h.ledger,
				repo: h.repo,
				registryFile: h.registryFile,
				transport: h.transport,
				tmux: h.ctx.tmux,
				opsi: h.ctx.tickOpsi,
			}).catch(() => []);
		const rows = agentRows(h.registryFile, h.ledger, h.ctx.tmux);
		h.io.stdout(
			rows.length
				? rows.map(formatAgentRow).join("\n")
				: "belum ada agent terdaftar; jalankan /rempug",
		);
	},

	doctor(_args, h) {
		const hasil = runDoctor(defaultDoctorDeps());
		h.io.stdout(formatDoctor(hasil));
		return hasil.ok ? 0 : 1;
	},

	async send(args, h) {
		const { values, positionals } = argumen(args, {
			queue: { type: "boolean" },
			after: { type: "string" },
			teliti: { type: "boolean" },
			centang: { type: "string" },
			brief: { type: "string" },
		});
		const [agent] = positionals;
		if (!agent)
			throw new UsageError(
				"pemakaian: rempug send <agent> [--queue] [--after N] [--teliti] [--centang berkas#nomor]  (brief dari stdin)",
			);
		h.ledger.purgeOlderThan(retentionDays(h.ctx.env));
		const brief = values.brief ?? (await h.io.stdin());
		const terdaftar = readAgents(h.registryFile).find((a) => a.name === agent);
		if (terdaftar && isStale(terdaftar, undefined)) {
			const hasil = await probeAgent(probeDeps(h), agent);
			h.io.stdout(
				`profil ${agent} usang (pengiriman gagal berulang); diprobe ulang: ${hasil.status}`,
			);
		}
		const hasil = await sendTask(sendDeps(h), {
			agent,
			brief,
			queue: values.queue,
			afterId: values.after === undefined ? undefined : idDari(values.after),
			teliti: values.teliti,
			centang: values.centang,
		});
		h.io.stdout(`T${hasil.id} ${hasil.status}`);
		if (hasil.peringatan) h.io.stdout(hasil.peringatan);
	},

	brief(args, h) {
		const id = idDari(args[0]);
		h.io.stdout(readBrief(h.ledger, id));
		// Agent yang membaca brief terbukti dapat dijangkau, jadi hitungan kegagalannya diulang dari nol.
		const agent = readAgents(h.registryFile).find(
			(a) => a.name === h.ledger.getTask(id)?.agent,
		);
		if (agent?.gagalBeruntun)
			updateAgent(h.registryFile, agent.name, { gagalBeruntun: 0 });
	},

	async paham(args, h) {
		const id = idDari(args[0]);
		const hasil = paham(h.ledger, id, await h.io.stdin());
		if (hasil.hasil === "LANJUT") return void h.io.stdout("LANJUT");
		if (hasil.hasil === "GAGAL-PAHAM")
			return void h.io.stdout(
				`GAGAL-PAHAM: terlalu banyak klarifikasi; berhenti dan jalankan \`rempug reply T${id} --gagal\`.`,
			);
		h.io.stdout(
			`MENUNGGU: ${hasil.alasan}\nJalankan \`rempug tunggu T${id}\` dan ulangi sampai LANJUT.`,
		);
	},

	async tunggu(args, h) {
		h.io.stdout(await tunggu(h.ledger, idDari(args[0])));
	},

	async jawab(args, h) {
		const id = idDari(args[0]);
		const teks = args.slice(1).join(" ").trim() || (await h.io.stdin()).trim();
		if (!teks)
			throw new UsageError(
				"pemakaian: rempug jawab <id> <teks>  (atau teks dari stdin)",
			);
		const hasil = await jawab(
			{
				ledger: h.ledger,
				registryFile: h.registryFile,
				transport: h.transport,
				tmux: h.ctx.tmux,
			},
			id,
			teks,
		);
		h.io.stdout(
			hasil === "disimpan"
				? `T${id}: jawaban disimpan; agent menerimanya lewat rempug tunggu`
				: `T${id}: jawaban dikirim ke agent`,
		);
	},

	async reply(args, h) {
		const { values, positionals } = argumen(args, {
			gagal: { type: "boolean" },
		});
		const id = idDari(positionals[0]);
		const { status } = reply(h.ledger, id, await h.io.stdin(), {
			gagal: values.gagal,
			spawnVerify: h.ctx.spawnVerify ?? ((n) => spawnVerifyBawaan(h.ctx, n)),
		});
		h.io.stdout(
			status === "gagal"
				? `OK T${id} ditandai gagal.`
				: `OK T${id} diterima; verifikasi berjalan.`,
		);
		if (status === "gagal") await pump(sendDeps(h)).catch(() => []);
	},

	async _verify(args, h) {
		const id = idDari(args[0]);
		const hasil = verifyTask(h.ledger, id);
		const task = kerjakan(h, id);
		if (hasil.ok && task.centang) {
			try {
				centangItem(task.centang, task.repo);
			} catch (error) {
				h.ledger.addEvent(
					id,
					"peringatan",
					`T${id} ${task.agent} ⚠ centang gagal: ${(error as Error).message}`,
				);
			}
		}
		await pump({ ...sendDeps(h), repo: task.repo }).catch(() => []);
	},

	log(args, h) {
		const { values } = argumen(args, { n: { type: "string" } });
		const n = Number(values.n ?? 20) || 20;
		const tasks = h.ledger.listTasks(h.repo).slice(-n);
		h.io.stdout(
			tasks.length ? tasks.map(barisLog).join("\n") : "belum ada tugas",
		);
	},

	show(args, h) {
		const { values, positionals } = argumen(args, {
			penuh: { type: "boolean" },
		});
		h.io.stdout(
			formatShow(kerjakan(h, idDari(positionals[0])), values.penuh === true),
		);
	},

	diff(args, h) {
		const id = idDari(args[0]);
		const task = kerjakan(h, id);
		if (args[1])
			return void h.io.stdout(unifiedDiff(h.ledger, task, task.repo, args[1]));
		const perubahan = computeChanges(h.ledger, task, task.repo);
		h.io.stdout(
			perubahan.length
				? perubahan
						.map(
							(f) =>
								`${f.status} ${f.path} +${f.plus}/−${f.minus}${f.biner ? " (biner)" : ""}`,
						)
						.join("\n")
				: "tidak ada perubahan",
		);
	},

	report(args, h) {
		const { values } = argumen(args, { md: { type: "string" } });
		const tasks = h.ledger.listTasks(h.repo);
		if (values.md) {
			writeFileSync(values.md, formatLaporanMd(h.repo, tasks));
			return void h.io.stdout(`laporan ditulis ke ${values.md}`);
		}
		h.io.stdout(formatLaporan(h.repo, tasks));
	},

	layar(args, h) {
		const { values, positionals } = argumen(args, {
			baris: { type: "string" },
		});
		const nama = positionals[0];
		const agent = readAgents(h.registryFile).find((a) => a.name === nama);
		if (!agent) throw new RempugError(`agent "${nama ?? ""}" tidak terdaftar`);
		h.io.stdout(
			h.transport.layar(agent.tmux, Number(values.baris ?? 30) || 30),
		);
	},

	async watch(args, h) {
		const { values } = argumen(args, {
			konsumen: { type: "string" },
			bangun: { type: "boolean" },
		});
		const kontrol = new AbortController();
		h.ctx.sinyal?.addEventListener("abort", () => kontrol.abort(), {
			once: true,
		});
		if (h.ctx.sinyal?.aborted) kontrol.abort();
		const pane = values.bangun
			? listPanes(h.ctx.tmux).find((p) => p.paneId === h.ctx.env.TMUX_PANE)
			: undefined;
		let putaran = 0;
		await watch({
			ledger: h.ledger,
			repo: h.repo,
			konsumen: values.konsumen,
			sinyal: kontrol.signal,
			intervalMs: h.ctx.watchMs ?? 1000,
			tulis: (baris) => {
				h.io.stdout(baris);
				if (pane)
					void bangunkan({
						transport: h.transport,
						target: pane.target,
						baris,
					});
			},
			tiapSiklus: async () => {
				if (++putaran % (h.ctx.tickSetiap ?? 3) !== 0) return;
				await tick({
					ledger: h.ledger,
					repo: h.repo,
					registryFile: h.registryFile,
					transport: h.transport,
					tmux: h.ctx.tmux,
					opsi: h.ctx.tickOpsi,
				}).catch(() => []);
				await pump(sendDeps(h)).catch(() => []);
			},
		});
	},

	skill(args, h) {
		if (args[0] !== "install")
			throw new UsageError("pemakaian: rempug skill install");
		const sumber = readFileSync(
			new URL("../../skills/rempug/SKILL.md", import.meta.url),
			"utf8",
		);
		const konfig =
			h.ctx.env.CLAUDE_CONFIG_DIR ||
			join(h.ctx.env.HOME || homedir(), ".claude");
		const tujuan = join(konfig, "skills", "rempug", "SKILL.md");
		let lama: string | undefined;
		try {
			lama = readFileSync(tujuan, "utf8");
		} catch {
			lama = undefined;
		}
		if (lama === sumber)
			return void h.io.stdout(`skill sudah terbaru: ${tujuan}`);
		mkdirSync(dirname(tujuan), { recursive: true });
		writeFileSync(tujuan, sumber);
		h.io.stdout(
			lama === undefined
				? `skill terpasang: ${tujuan}`
				: `skill diperbarui: ${tujuan}`,
		);
	},

	async mcp(_args, h) {
		const { jalankanMcp } = await import("./mcp.js");
		const { io: _io, ...dasar } = h.ctx;
		await jalankanMcp(dasar, versiPaket());
	},

	terima(_args, h) {
		for (const baris of terima(h.ledger, h.repo)) h.io.stdout(baris);
	},

	async status(_args, h) {
		h.ledger.purgeOlderThan(retentionDays(h.ctx.env));
		const bagian: string[] = [];
		const panes = listPanes(h.ctx.tmux);
		const dibersihkan: string[] = [];
		for (const a of readAgents(h.registryFile))
			if (!panes.some((p) => p.target === a.tmux)) {
				removeAgent(h.registryFile, a.name);
				dibersihkan.push(a.name);
			}
		const rows = agentRows(h.registryFile, h.ledger, h.ctx.tmux);
		if (rows.length)
			bagian.push(
				rows
					.map(
						(r) =>
							`${r.name} ${r.tidakAndal ? "tidak-andal" : r.status}${r.tugas === undefined ? "" : ` (T${r.tugas})`}`,
					)
					.join(", "),
			);
		const baru = scan(h.repo, { tmux: h.ctx.tmux }).kandidat.filter(
			(c) => c.keyakinan === "tinggi" && !rows.some((r) => r.tmux === c.target),
		);
		if (baru.length)
			bagian.push(
				`baru: ${baru.map((c) => `${c.jenis} (${c.target})`).join(", ")}`,
			);
		if (dibersihkan.length)
			bagian.push(`dibersihkan: ${dibersihkan.join(", ")}`);
		const versi = h.ctx.versi ?? versiAgent;
		const usang = rows
			.filter((r) => isStale(r, versi(r.kind)))
			.map((r) => r.name);
		if (usang.length)
			bagian.push(`usang: ${usang.join(", ")} (jalankan probe)`);
		const kons = h.ledger.getConsumer(KONSUMEN);
		const hidup =
			kons?.lastSeen !== undefined && h.ledger.now() - kons.lastSeen <= 10;
		if (rows.length) bagian.push(hidup ? "pantau aktif" : "pantau mati");
		h.io.stdout(
			bagian.length
				? `rempug: ${bagian.join(" | ")}`
				: "rempug: belum ada agent; jalankan /rempug",
		);
	},
};

/** Perintah yang menempel penanda kejadian tertunda di awal keluarannya (hanya yang dipakai orkestrator). */
const BERPENANDA = new Set([
	"ls",
	"send",
	"jawab",
	"log",
	"show",
	"diff",
	"report",
	"layar",
	"status",
	"probe",
	"register",
]);

function versiPaket(): string {
	const pkg = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	) as { version: string };
	return pkg.version;
}

/** Menjalankan satu perintah rempug dan mengembalikan kode keluar. Tidak pernah melempar. */
export async function run(argv: string[], ctx: Ctx): Promise<number> {
	const [cmd, ...args] = argv;
	const { io } = ctx;
	if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
		io.stdout(USAGE);
		return 0;
	}
	if (cmd === "--version") {
		io.stdout(versiPaket());
		return 0;
	}
	let ledger: Ledger | undefined;
	try {
		const handler = HANDLERS[cmd];
		if (!handler)
			throw new UsageError(`perintah "${cmd}" tidak dikenal; lihat --help`);
		const h: H = {
			get ledger() {
				ledger ??= Ledger.open(ledgerPath(ctx.env));
				return ledger;
			},
			repo: repoRoot(ctx.cwd),
			registryFile: registryPath(ctx.env),
			transport: ctx.transport ?? tmuxTransport(ctx.tmux),
			ctx,
			io,
		};
		if (BERPENANDA.has(cmd)) {
			const penanda = penandaTertunda(h.ledger, h.repo);
			if (penanda) io.stdout(penanda);
		}
		const hasil = await handler(args, h);
		return typeof hasil === "number" ? hasil : 0;
	} catch (error) {
		if (error instanceof RempugError) {
			io.stderr(`rempug: ${error.message}`);
			return error.kode;
		}
		io.stderr(`rempug: galat tak terduga: ${(error as Error).stack ?? error}`);
		return 1;
	} finally {
		ledger?.close();
	}
}
