import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type DoctorDeps,
	formatDoctor,
	runDoctor,
} from "../../src/core/doctor.js";

const sehat: DoctorDeps = {
	nodeVersion: "26.10.0",
	tmuxVersion: () => "tmux 3.6",
	which: (cmd) => `/usr/bin/${cmd}`,
};

test("semua sehat: ok dan tiap pemeriksaan lulus", () => {
	const hasil = runDoctor(sehat);
	assert.equal(hasil.ok, true);
	assert.deepEqual(
		hasil.checks.map((c) => [c.nama, c.ok]),
		[
			["node", true],
			["tmux", true],
			["path", true],
		],
	);
});

test("Node terlalu rendah gagal dan menyebut cara memperbaiki", () => {
	const hasil = runDoctor({ ...sehat, nodeVersion: "20.0.0" });
	assert.equal(hasil.ok, false);
	const node = hasil.checks.find((c) => c.nama === "node");
	assert.equal(node?.ok, false);
	assert.match(node?.pesan ?? "", /22\.13/);
	assert.match(node?.perbaikan ?? "", /nvm|Node/);
});

test("tmux tidak ada gagal dan menyebut cara memasang", () => {
	const hasil = runDoctor({ ...sehat, tmuxVersion: () => undefined });
	const tmux = hasil.checks.find((c) => c.nama === "tmux");
	assert.equal(tmux?.ok, false);
	assert.match(tmux?.perbaikan ?? "", /apt install tmux/);
	assert.match(tmux?.perbaikan ?? "", /brew install tmux/);
});

test("rempug tidak ada di PATH gagal dan menyebut cara memasang", () => {
	const hasil = runDoctor({
		...sehat,
		which: (cmd) => (cmd === "rempug" ? undefined : `/usr/bin/${cmd}`),
	});
	const path = hasil.checks.find((c) => c.nama === "path");
	assert.equal(path?.ok, false);
	assert.match(path?.perbaikan ?? "", /npm i -g rempug/);
});

test("formatDoctor: satu baris per pemeriksaan, perbaikan hanya pada yang gagal", () => {
	const teks = formatDoctor(
		runDoctor({ ...sehat, tmuxVersion: () => undefined }),
	);
	const baris = teks.split("\n");
	assert.equal(baris.length, 4);
	assert.match(baris[0] ?? "", /^✓ node/);
	assert.match(baris[1] ?? "", /^✗ tmux/);
	assert.match(baris[1] ?? "", /apt install tmux/);
	assert.match(baris[2] ?? "", /^✓ path/);
	assert.match(baris[3] ?? "", /tidak lulus/);
});
