import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { centangItem } from "../../src/core/centang.js";
import { tmp } from "../helpers.js";

const ISI = `# Rencana

- [ ] 1. Kerangka
  - [ ] 1.1 Paket
  - [ ] 1.2 Uji
- [ ] 2. Ledger
  - [ ] 2.1 Skema
  - [x] 2.2 Sudah selesai
- [ ] 12. Dua belas
`;

function siapkan(t: Parameters<typeof tmp>[0]) {
	const repo = tmp(t);
	mkdirSync(join(repo, "spec"));
	writeFileSync(join(repo, "spec", "tasks.md"), ISI);
	return {
		repo,
		baca: () => readFileSync(join(repo, "spec", "tasks.md"), "utf8"),
	};
}

test("hanya baris item yang dituju yang berubah", (t) => {
	const { repo, baca } = siapkan(t);
	assert.equal(centangItem("spec/tasks.md#1.2", repo), true);
	assert.equal(baca(), ISI.replace("- [ ] 1.2 Uji", "- [x] 1.2 Uji"));
});

test("nomor tingkat atas (dengan titik) dan nomor yang mirip tidak tertukar", (t) => {
	const { repo, baca } = siapkan(t);
	centangItem("spec/tasks.md#2", repo);
	assert.match(baca(), /- \[x\] 2\. Ledger/);
	assert.match(baca(), /- \[ \] 2\.1 Skema/);
	assert.match(baca(), /- \[ \] 12\. Dua belas/);
	centangItem("spec/tasks.md#1", repo);
	assert.match(baca(), /- \[x\] 1\. Kerangka/);
	assert.match(baca(), /- \[ \] 1\.1 Paket/);
});

test("item yang sudah tercentang tidak mengubah apa pun", (t) => {
	const { repo, baca } = siapkan(t);
	assert.equal(centangItem("spec/tasks.md#2.2", repo), false);
	assert.equal(baca(), ISI);
});

test("item tidak ada, berkas tidak ada, atau spesifikasi salah ditolak", (t) => {
	const { repo, baca } = siapkan(t);
	assert.throws(() => centangItem("spec/tasks.md#9.9", repo), /9\.9/);
	assert.throws(() => centangItem("spec/lain.md#1", repo), /lain\.md/);
	assert.throws(() => centangItem("spec/tasks.md", repo), /berkas#nomor/);
	assert.equal(baca(), ISI);
});

test("path di luar repo ditolak", (t) => {
	const { repo } = siapkan(t);
	assert.throws(() => centangItem("../luar/tasks.md#1", repo), /di luar repo/);
	assert.throws(() => centangItem("/etc/tasks.md#1", repo), /di luar repo/);
});
