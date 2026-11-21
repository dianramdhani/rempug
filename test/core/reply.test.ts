import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Ledger, type TaskStatus } from "../../src/core/ledger.js";
import { reply } from "../../src/core/reply.js";
import { tmp } from "../helpers.js";

function siapkan(
	t: Parameters<typeof tmp>[0],
	status: TaskStatus = "berjalan",
) {
	const ledger = Ledger.open(join(tmp(t), "l.db"));
	t.after(() => ledger.close());
	const id = ledger.createTask({
		repo: "/r",
		agent: "codex",
		mode: "baca",
		brief: "b",
	});
	ledger.setStatus(id, status);
	const diverifikasi: number[] = [];
	return {
		ledger,
		id,
		diverifikasi,
		spawnVerify: (n: number) => diverifikasi.push(n),
	};
}

test("balasan normal: status memverifikasi, ringkasan dibatasi, detail utuh, verifikasi dipicu", (t) => {
	const { ledger, id, diverifikasi, spawnVerify } = siapkan(t);
	const teks = Array.from({ length: 20 }, (_, i) => `baris ${i + 1}`).join(
		"\n",
	);
	assert.equal(
		reply(ledger, id, teks, { spawnVerify }).status,
		"memverifikasi",
	);
	const task = ledger.getTask(id);
	assert.equal(task?.status, "memverifikasi");
	assert.equal(task?.replySummary?.split("\n").length, 12);
	assert.equal(task?.replySummary?.split("\n")[11], "baris 12");
	assert.equal(task?.replyDetail, teks);
	assert.ok(task?.repliedAt !== undefined);
	assert.deepEqual(diverifikasi, [id]);
});

test("ringkasan membuang baris kosong dan memotong baris yang terlalu panjang", (t) => {
	const { ledger, id, spawnVerify } = siapkan(t);
	reply(ledger, id, `\n\n${"x".repeat(500)}\n\nkedua\n`, { spawnVerify });
	const [satu, dua] = ledger.getTask(id)?.replySummary?.split("\n") ?? [];
	assert.equal(satu?.length, 200);
	assert.match(satu ?? "", /…$/);
	assert.equal(dua, "kedua");
});

test("--gagal: status gagal dengan alasan, event dicatat, verifikasi tidak dipicu", (t) => {
	const { ledger, id, diverifikasi, spawnVerify } = siapkan(t);
	assert.equal(
		reply(ledger, id, "limit habis", { gagal: true, spawnVerify }).status,
		"gagal",
	);
	assert.equal(ledger.getTask(id)?.status, "gagal");
	assert.equal(ledger.getTask(id)?.replySummary, "limit habis");
	assert.deepEqual(diverifikasi, []);
	assert.match(
		ledger.eventsAfter(0, "/r")[0]?.line ?? "",
		new RegExp(`T${id} codex ✗ gagal: limit habis`),
	);
});

test("balasan dari tugas macet atau menunggu klarifikasi diterima", (t) => {
	for (const status of ["macet", "menunggu-klarifikasi"] as const) {
		const { ledger, id, spawnVerify } = siapkan(t, status);
		reply(ledger, id, "ok", { spawnVerify });
		assert.equal(ledger.getTask(id)?.status, "memverifikasi", status);
	}
});

test("balasan untuk tugas yang tidak ada atau tidak aktif ditolak tanpa mengubah ledger", (t) => {
	const ok = siapkan(t);
	assert.throws(
		() => reply(ok.ledger, 999, "x", { spawnVerify: ok.spawnVerify }),
		/T999/,
	);
	for (const status of [
		"antri",
		"selesai",
		"gagal",
		"memverifikasi",
	] as const) {
		const { ledger, id, diverifikasi, spawnVerify } = siapkan(t, status);
		assert.throws(
			() => reply(ledger, id, "x", { spawnVerify }),
			new RegExp(status),
		);
		assert.equal(ledger.getTask(id)?.status, status);
		assert.equal(ledger.getTask(id)?.replySummary, undefined);
		assert.deepEqual(diverifikasi, []);
	}
});
