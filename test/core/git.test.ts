import assert from "node:assert/strict";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gitFiles, gitInfo, isGitRepo, repoRoot } from "../../src/core/git.js";
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
