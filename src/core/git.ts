import { spawnSync } from "node:child_process";

function git(repo: string, args: string[]): string | undefined {
	const result = spawnSync("git", ["-C", repo, ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	return result.status === 0 ? result.stdout : undefined;
}

export interface GitInfo {
	head?: string;
	branch?: string;
	/** Keluaran `git status --porcelain`, satu entri per baris. */
	porcelain?: string;
}

/** Akar repo git dari `cwd`; jatuh ke `cwd` bila bukan repo git. */
export function repoRoot(cwd: string): string {
	return git(cwd, ["rev-parse", "--show-toplevel"])?.trim() || cwd;
}

export function isGitRepo(dir: string): boolean {
	return git(dir, ["rev-parse", "--git-dir"]) !== undefined;
}

export function gitInfo(repo: string): GitInfo {
	return {
		head: git(repo, ["rev-parse", "HEAD"])?.trim(),
		branch: git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim(),
		porcelain: git(repo, ["status", "--porcelain", "-uall"])?.trimEnd(),
	};
}

/** Daftar berkas terlacak maupun tidak terlacak (tanpa yang diabaikan) di bawah pathspec. */
export function gitFiles(repo: string, pathspecs: string[]): string[] {
	const out = git(repo, [
		"ls-files",
		"-z",
		"--cached",
		"--others",
		"--exclude-standard",
		"--",
		...pathspecs,
	]);
	return out ? out.split("\0").filter(Boolean) : [];
}
