import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { Ledger, ledgerPath } from "../src/core/ledger.js";
import { registerAgent } from "../src/core/registry.js";
import type { TmuxOpts } from "../src/core/tmux.js";
import { tmuxTransport } from "../src/core/transport.js";

const direktoriSementara: string[] = [];
process.on("exit", () => {
	for (const dir of direktoriSementara)
		rmSync(dir, { recursive: true, force: true });
});

/**
 * Membuat direktori sementara. Penghapusannya ditunda sampai proses uji berakhir: hook `t.after` berjalan
 * menurut urutan pendaftaran, jadi menghapus di sana berpapasan dengan ledger yang belum ditutup dan agent
 * palsu yang masih menulis (ENOTEMPTY di runner yang lambat). Saat proses keluar semuanya sudah ditutup.
 */
export function tmp(_t: TestContext): string {
	const dir = mkdtempSync(join(tmpdir(), "rempug-"));
	direktoriSementara.push(dir);
	return dir;
}

/** Mengulang `fn` sampai mengembalikan nilai selain `undefined`, atau gagal setelah `ms`. */
/**
 * Batas bawaan 20 dtk: kondisi yang ditunggu (agent palsu menyala, pointer tiba) biasanya tercapai dalam
 * sepersekian detik, tetapi memulai Node dan tmux di mesin yang sibuk bisa melewati 4 dtk.
 */
export async function until<T>(
	fn: () => T | undefined,
	ms = 20_000,
): Promise<T> {
	const end = Date.now() + ms;
	for (;;) {
		const value = fn();
		if (value !== undefined) return value;
		if (Date.now() > end) throw new Error("until: waktu habis");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

/** Seperti `until`, tetapi untuk pemeriksaan asinkron. */
export async function untilAsync<T>(
	fn: () => Promise<T | undefined>,
	ms = 20_000,
): Promise<T> {
	const end = Date.now() + ms;
	for (;;) {
		const value = await fn();
		if (value !== undefined) return value;
		if (Date.now() > end) throw new Error("untilAsync: waktu habis");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

function tmuxEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env.TMUX;
	return env;
}

/** Server tmux sementara di socket sendiri; dimatikan otomatis setelah uji. */
export function startTmux(t: TestContext) {
	const socket = `rempug-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
	const opts: TmuxOpts = { socket };
	const bin = tmp(t);
	t.after(() => {
		spawnSync("tmux", ["-L", socket, "kill-server"], { env: tmuxEnv() });
		// tmux tidak selalu menghapus berkas socket (mis. saat sesi terakhir dimatikan), jadi dihapus di sini.
		const dir = join(
			process.env.TMUX_TMPDIR || "/tmp",
			`tmux-${process.getuid?.()}`,
		);
		rmSync(join(dir, socket), { force: true });
	});
	return {
		opts,
		/**
		 * Memulai sesi yang menjalankan biner bernama `name` (salinan `node` yang menunggu), sehingga perintah pane-nya `name`.
		 * Bukan `sleep`: di sebagian distro `sleep` adalah biner multi-call yang menolak berjalan dengan nama lain.
		 */
		newSession(session: string, cwd: string, name: string): void {
			const dir = join(bin, session);
			mkdirSync(dir, { recursive: true });
			const exe = join(dir, name);
			copyFileSync(process.execPath, exe);
			chmodSync(exe, 0o755);
			execFileSync(
				"tmux",
				[
					"-L",
					socket,
					"-f",
					"/dev/null",
					"new-session",
					"-d",
					"-s",
					session,
					"-c",
					cwd,
					`exec ${exe} -e "setTimeout(() => {}, 300000)"`,
				],
				{ env: tmuxEnv() },
			);
		},
		/** Memulai sesi yang menjalankan agent palsu (`test/fake-agent.js`) dengan env tambahan. */
		newFakeAgent(
			session: string,
			cwd: string,
			args: string[],
			env: Record<string, string> = {},
		): void {
			const script = fileURLToPath(new URL("./fake-agent.js", import.meta.url));
			const q = (v: string) => `'${v.replace(/'/g, "'\\''")}'`;
			const vars = Object.entries(env).map(([k, v]) => `${k}=${q(v)}`);
			const command = `exec env ${vars.join(" ")} ${q(process.execPath)} ${q(script)} ${args.map(q).join(" ")}`;
			execFileSync(
				"tmux",
				[
					"-L",
					socket,
					"-f",
					"/dev/null",
					"new-session",
					"-d",
					"-s",
					session,
					"-c",
					cwd,
					command,
				],
				{ env: tmuxEnv() },
			);
		},
		killSession(session: string): void {
			execFileSync(
				"tmux",
				["-L", socket, "kill-session", "-t", `=${session}`],
				{
					env: tmuxEnv(),
				},
			);
		},
	};
}

/** Repo git sementara dengan satu commit awal; `berkas` adalah isi awal (path → teks). */
export function gitRepo(
	t: TestContext,
	berkas: Record<string, string> = { "README.md": "halo\n" },
): string {
	const dir = tmp(t);
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
	git("init", "-q", "-b", "main");
	git("config", "user.email", "uji@example.com");
	git("config", "user.name", "Uji");
	for (const [path, isi] of Object.entries(berkas)) {
		const full = join(dir, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, isi);
	}
	git("add", "-A");
	git("commit", "-q", "-m", "awal");
	return dir;
}

export interface SpesAgen {
	name: string;
	/** `normal`, `paste`, atau `menu`; lihat `fake-agent.ts`. */
	mode?: string;
	env?: Record<string, string>;
}

/**
 * Menyalakan agent palsu di tmux terpisah, mendaftarkannya, dan membuka ledger yang dipakai bersama
 * agent palsu itu (lewat XDG_STATE_HOME). `now` mengatur jam ledger.
 */
export async function ujiAgen(
	t: TestContext,
	agen: SpesAgen[],
	opsi: { now?: () => number } = {},
) {
	const dir = tmp(t);
	const tmux = startTmux(t);
	const transport = tmuxTransport(tmux.opts);
	const registryFile = join(dir, "registry.json");
	const stateHome = join(dir, "state");
	const ledger = Ledger.open(ledgerPath({ XDG_STATE_HOME: stateHome }), {
		now: opsi.now,
	});
	t.after(() => ledger.close());
	const log = (nama: string) => join(dir, `${nama}.log`);
	for (const [i, a] of agen.entries()) {
		const sesi = String(i + 1);
		tmux.newFakeAgent(sesi, dir, [a.mode ?? "normal", log(a.name)], {
			XDG_STATE_HOME: stateHome,
			...a.env,
		});
		await until(() =>
			transport.layar(`${sesi}:0.0`).includes("fake-agent") ? true : undefined,
		);
		registerAgent(registryFile, {
			name: a.name,
			kind: "codex",
			tmux: `${sesi}:0.0`,
			capabilities: [],
		});
	}
	const diterima = (nama: string): string[] => {
		try {
			return readFileSync(log(nama), "utf8").trim().split("\n").filter(Boolean);
		} catch {
			return [];
		}
	};
	return { dir, tmux, transport, registryFile, ledger, diterima };
}
