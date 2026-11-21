import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	changedFilesBetween,
	commitsBetween,
	gitFiles,
	gitInfo,
	isAncestor,
	isGitRepo,
	repoRoot,
} from "../../src/core/git.js";
import { gitRepo, tmp } from "../helpers.js";

test("gitInfo di repo bersih: HEAD, branch, dan porcelain kosong", (t) => {
	const repo = gitRepo(t);
	const info = gitInfo(repo);
	assert.match(info.head ?? "", /^[0-9a-f]{40}$/);
	assert.equal(info.branch, "main");
	assert.equal(info.porcelain, "");
});

test("gitInfo melaporkan berkas berubah dan tidak terlacak", (t) => {
	const repo = gitRepo(t);
	writeFileSync(join(repo, "README.md"), "berubah\n");
	writeFileSync(join(repo, "baru.txt"), "x\n");
	const baris = (gitInfo(repo).porcelain ?? "").split("\n").sort();
	assert.deepEqual(baris, ["?? baru.txt", " M README.md"].sort());
});

test("gitInfo di direktori non-git tidak melempar dan semua bidang kosong", (t) => {
	assert.deepEqual(gitInfo(tmp(t)), {
		head: undefined,
		branch: undefined,
		porcelain: undefined,
	});
	assert.deepEqual(gitInfo("/tidak/ada/sama/sekali"), {
		head: undefined,
		branch: undefined,
		porcelain: undefined,
	});
});

test("gitFiles: terlacak dan tidak terlacak, tanpa yang diabaikan", (t) => {
	const repo = gitRepo(t, {
		"src/a.ts": "a",
		"src/sub/b.ts": "b",
		"lain/c.ts": "c",
		".gitignore": "*.log\n",
	});
	writeFileSync(join(repo, "src", "baru.ts"), "n");
	writeFileSync(join(repo, "src", "debug.log"), "diabaikan");
	assert.deepEqual(gitFiles(repo, ["src"]).sort(), [
		"src/a.ts",
		"src/baru.ts",
		"src/sub/b.ts",
	]);
	assert.deepEqual(gitFiles(repo, ["src/sub/**"]), ["src/sub/b.ts"]);
	assert.deepEqual(gitFiles(repo, ["tidak-ada"]), []);
});

test("repoRoot dan isGitRepo", (t) => {
	const repo = gitRepo(t, { "src/a.ts": "a" });
	mkdirSync(join(repo, "src", "dalam"), { recursive: true });
	// git mengembalikan path asli (di macOS /var adalah symlink ke /private/var).
	assert.equal(repoRoot(join(repo, "src", "dalam")), realpathSync(repo));
	assert.equal(isGitRepo(repo), true);
	const luar = tmp(t);
	assert.equal(isGitRepo(luar), false);
	assert.equal(repoRoot(luar), luar);
});

test("isAncestor, commitsBetween, dan changedFilesBetween menjelaskan bagaimana HEAD bergerak", (t) => {
	const repo = gitRepo(t, { "src/a.ts": "a\n", "lib/c.ts": "c\n" });
	const awal = gitInfo(repo).head as string;
	writeFileSync(join(repo, "lib", "c.ts"), "c2\n");
	execFileSync("git", ["-C", repo, "commit", "-aqm", "satu"]);
	writeFileSync(join(repo, "docs.md"), "d\n");
	execFileSync("git", ["-C", repo, "add", "-A"]);
	execFileSync("git", ["-C", repo, "commit", "-qm", "dua"]);
	const kini = gitInfo(repo).head as string;

	assert.equal(isAncestor(repo, awal, kini), true);
	assert.equal(isAncestor(repo, kini, awal), false);
	assert.equal(commitsBetween(repo, awal, kini), 2);
	assert.deepEqual(changedFilesBetween(repo, awal, kini).sort(), [
		"docs.md",
		"lib/c.ts",
	]);

	execFileSync("git", [
		"-C",
		repo,
		"commit",
		"--amend",
		"-qm",
		"ditulis ulang",
	]);
	assert.equal(isAncestor(repo, kini, gitInfo(repo).head as string), false);
	assert.equal(isAncestor(repo, "bukan-sha", kini), false);
});
