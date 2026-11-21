import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const pkg = JSON.parse(
	readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

function run(...args: string[]) {
	return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

test("--version mencetak versi paket dan keluar dengan kode 0", () => {
	const result = run("--version");
	assert.equal(result.status, 0);
	assert.equal(result.stdout.trim(), pkg.version);
});

test("perintah yang belum ada ditolak dengan kode 2 dan pesan di stderr", () => {
	const result = run("tidak-ada");
	assert.equal(result.status, 2);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /tidak-ada/);
});
