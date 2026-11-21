import { spawnSync } from "node:child_process";

export interface TmuxOpts {
	/** Nama socket (`tmux -L`); kosong berarti server tmux bawaan. */
	socket?: string;
}

export interface Pane {
	session: string;
	window: number;
	pane: number;
	/** ID pane tmux (`%3`); hanya unik dalam satu server. */
	paneId: string;
	/** Perintah yang sedang berjalan di pane. */
	command: string;
	/** Direktori kerja pane. */
	path: string;
	/** Bentuk `sesi:window.pane`; transport menambahkan `=` di depan sesi saat mengirim. */
	target: string;
}

export function runTmux(args: string[], opts: TmuxOpts = {}, input?: string) {
	return spawnSync(
		"tmux",
		[...(opts.socket ? ["-L", opts.socket] : []), ...args],
		{ encoding: "utf8", input },
	);
}

/** Semua pane di semua sesi; daftar kosong bila tmux tidak ada atau belum ada server. */
export function listPanes(opts: TmuxOpts = {}): Pane[] {
	const format = [
		"#{session_name}",
		"#{window_index}",
		"#{pane_index}",
		"#{pane_id}",
		"#{pane_current_command}",
		"#{pane_current_path}",
	].join("\t");
	const result = runTmux(["list-panes", "-a", "-F", format], opts);
	if (result.error || result.status !== 0) return [];
	return result.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [
				session = "",
				window = "0",
				pane = "0",
				paneId = "",
				command = "",
				path = "",
			] = line.split("\t");
			return {
				session,
				window: Number(window),
				pane: Number(pane),
				paneId,
				command,
				path,
				target: `${session}:${window}.${pane}`,
			};
		});
}
