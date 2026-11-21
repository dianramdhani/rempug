import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
	readAgents,
	registerAgent,
	registryPath,
	removeAgent,
} from "../../src/core/registry.js";
import { tmp } from "../helpers.js";

const codex = {
	name: "codex",
	kind: "codex",
	tmux: "2:0.0",
	capabilities: ["playwright"],
};

test("registryPath mengikuti XDG_CONFIG_HOME, lalu HOME", () => {
	assert.equal(
		registryPath({ XDG_CONFIG_HOME: "/x" }),
		"/x/rempug/registry.json",
	);
	assert.equal(registryPath({ HOME: "/h" }), "/h/.config/rempug/registry.json");
});

test("berkas yang belum ada dibaca sebagai daftar kosong", (t) => {
	assert.deepEqual(readAgents(join(tmp(t), "tidak", "ada.json")), []);
});

test("menyimpan lalu memuat agent, membuat direktori, tanpa sisa berkas sementara", (t) => {
	const file = join(tmp(t), "cfg", "registry.json");
	registerAgent(file, codex);
	registerAgent(file, { ...codex, name: "agy", kind: "agy", tmux: "1:0.0" });
	assert.deepEqual(
		readAgents(file).map((a) => a.name),
		["codex", "agy"],
	);
	assert.deepEqual(readAgents(file)[0], codex);
	assert.deepEqual(readdirSync(dirname(file)), ["registry.json"]);
});

test("menolak nama ganda dan target ganda", (t) => {
	const file = join(tmp(t), "registry.json");
	registerAgent(file, codex);
	assert.throws(
		() => registerAgent(file, { ...codex, tmux: "9:0.0" }),
		/"codex" sudah terdaftar/,
	);
	assert.throws(
		() => registerAgent(file, { ...codex, name: "lain" }),
		/sudah dipakai agent "codex"/,
	);
	assert.equal(readAgents(file).length, 1);
});

test("menolak nama yang tidak valid", (t) => {
	const file = join(tmp(t), "registry.json");
	for (const name of ["", "Codex", "1abc", "a b", "a/b", "x".repeat(31)]) {
		assert.throws(
			() => registerAgent(file, { ...codex, name }),
			/nama agent/,
			name,
		);
	}
	assert.equal(existsSync(file), false);
});

test("removeAgent menghapus yang ada dan melaporkan yang tidak ada", (t) => {
	const file = join(tmp(t), "registry.json");
	registerAgent(file, codex);
	assert.equal(removeAgent(file, "codex"), true);
	assert.equal(removeAgent(file, "codex"), false);
	assert.deepEqual(readAgents(file), []);
});

test("berkas rusak menghasilkan galat yang menyebut path-nya", (t) => {
	const file = join(tmp(t), "registry.json");
	writeFileSync(file, "{ bukan json");
	assert.throws(() => readAgents(file), new RegExp(file.replace(/\//g, "\\/")));
});
