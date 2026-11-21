import { listPanes, type Pane, type TmuxOpts } from "./tmux.js";

/** Perintah yang dikenali sebagai agent CLI; juga menjadi `jenis`. */
const KNOWN_KINDS = new Set(["codex", "agy", "claude", "gemini", "opencode"]);

/** Perintah yang bukan agent: editor, shell, dan pager. */
const EXCLUDED = new Set([
	"nvim",
	"vim",
	"vi",
	"bash",
	"zsh",
	"sh",
	"fish",
	"dash",
	"less",
	"htop",
	"top",
	"man",
	"tmux",
]);

export type Confidence = "tinggi" | "sedang" | "rendah";

export interface Candidate {
	target: string;
	sesi: string;
	perintah: string;
	direktori: string;
	jenis: string;
	skor: number;
	keyakinan: Confidence;
}

function score(pane: Pane, repo: string): number {
	let skor = KNOWN_KINDS.has(pane.command) ? 3 : 0;
	if (pane.path === repo) skor += 2;
	else if (pane.path.startsWith(`${repo}/`)) skor += 1;
	return skor;
}

/** Memberi skor keyakinan tiap pane dan membuang pane orkestrator sendiri serta pane non-agent. */
export function scorePanes(
	panes: Pane[],
	repo: string,
	selfPane?: string,
): Candidate[] {
	return panes
		.filter((p) => p.paneId !== selfPane && !EXCLUDED.has(p.command))
		.map((p) => {
			const skor = score(p, repo);
			return {
				target: p.target,
				sesi: p.session,
				perintah: p.command,
				direktori: p.path,
				jenis: KNOWN_KINDS.has(p.command) ? p.command : "tidak-diketahui",
				skor,
				keyakinan: (skor >= 3
					? "tinggi"
					: skor >= 1
						? "sedang"
						: "rendah") as Confidence,
			};
		})
		.sort((a, b) => b.skor - a.skor || a.target.localeCompare(b.target));
}

export interface ScanOptions {
	tmux?: TmuxOpts;
	/** Pane orkestrator yang dikecualikan; bawaannya `$TMUX_PANE` bila memakai server tmux bawaan. */
	selfPane?: string;
}

export function scan(repo: string, options: ScanOptions = {}) {
	// ID pane hanya unik dalam satu server, jadi `$TMUX_PANE` tidak berarti untuk socket lain.
	const selfPane =
		options.selfPane ??
		(options.tmux?.socket ? undefined : process.env.TMUX_PANE);
	return {
		repo,
		kandidat: scorePanes(listPanes(options.tmux), repo, selfPane),
	};
}
