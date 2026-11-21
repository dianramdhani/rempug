import { spawnSync } from "node:child_process";
import { checkNodeVersion, MIN_NODE } from "../runtime.js";

export interface DoctorDeps {
	nodeVersion: string;
	/** Keluaran `tmux -V`, atau `undefined` bila tmux tidak ada. */
	tmuxVersion: () => string | undefined;
	/** Lokasi perintah di PATH, atau `undefined` bila tidak ada. */
	which: (command: string) => string | undefined;
}

export interface Check {
	nama: "node" | "tmux" | "path";
	ok: boolean;
	pesan: string;
	perbaikan?: string;
}

export interface DoctorResult {
	ok: boolean;
	checks: Check[];
}

export function defaultDoctorDeps(): DoctorDeps {
	return {
		nodeVersion: process.versions.node,
		tmuxVersion: () => {
			const result = spawnSync("tmux", ["-V"], { encoding: "utf8" });
			return result.status === 0 ? result.stdout.trim() : undefined;
		},
		// Shell login mendekati lingkungan shell yang dipakai agent di pane tmux.
		which: (command) => {
			const result = spawnSync(
				"sh",
				["-lc", 'command -v "$1"', "sh", command],
				{
					encoding: "utf8",
				},
			);
			return result.status === 0 ? result.stdout.trim() : undefined;
		},
	};
}

export function runDoctor(
	deps: DoctorDeps = defaultDoctorDeps(),
): DoctorResult {
	const node = checkNodeVersion(deps.nodeVersion);
	const tmux = deps.tmuxVersion();
	const rempug = deps.which("rempug");
	const checks: Check[] = [
		node.ok
			? { nama: "node", ok: true, pesan: `Node ${deps.nodeVersion}` }
			: {
					nama: "node",
					ok: false,
					pesan: node.message,
					perbaikan: `pasang Node ${MIN_NODE} atau lebih baru (mis. \`nvm install 22\`)`,
				},
		tmux
			? { nama: "tmux", ok: true, pesan: tmux }
			: {
					nama: "tmux",
					ok: false,
					pesan: "tmux tidak ditemukan",
					perbaikan:
						"pasang tmux: `apt install tmux` (Linux) atau `brew install tmux` (macOS)",
				},
		rempug
			? { nama: "path", ok: true, pesan: rempug }
			: {
					nama: "path",
					ok: false,
					pesan: "perintah `rempug` tidak ada di PATH shell",
					perbaikan:
						"jalankan `npm i -g rempug` agar agent dapat memanggil `rempug`",
				},
	];
	return { ok: checks.every((c) => c.ok), checks };
}

export function formatDoctor(result: DoctorResult): string {
	const baris = result.checks.map((c) =>
		c.ok
			? `✓ ${c.nama}  ${c.pesan}`
			: `✗ ${c.nama}  ${c.pesan} — ${c.perbaikan}`,
	);
	const gagal = result.checks.filter((c) => !c.ok).length;
	baris.push(gagal === 0 ? "semua lulus" : `${gagal} pemeriksaan tidak lulus`);
	return baris.join("\n");
}
