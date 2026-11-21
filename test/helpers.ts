import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { TmuxOpts } from "../src/core/tmux.js";

/** Membuat direktori sementara yang dihapus otomatis setelah uji selesai. */
export function tmp(t: TestContext): string {
	const dir = mkdtempSync(join(tmpdir(), "rempug-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** Mengulang `fn` sampai mengembalikan nilai selain `undefined`, atau gagal setelah `ms`. */
export async function until<T>(fn: () => T | undefined, ms = 4000): Promise<T> {
	const end = Date.now() + ms;
	for (;;) {
		const value = fn();
		if (value !== undefined) return value;
		if (Date.now() > end) throw new Error("until: waktu habis");
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
		const args = ["-L", socket];
		// tmux tidak menghapus berkas socket setelah kill-server, jadi path-nya diambil dulu lalu dihapus sendiri.
		const path = spawnSync(
			"tmux",
			[...args, "display-message", "-p", "#{socket_path}"],
			{ encoding: "utf8", env: tmuxEnv() },
		).stdout.trim();
		spawnSync("tmux", [...args, "kill-server"], { env: tmuxEnv() });
		if (path) rmSync(path, { force: true });
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
