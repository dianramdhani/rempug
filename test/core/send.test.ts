import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Ledger } from "../../src/core/ledger.js";
import { registerAgent, updateAgent } from "../../src/core/registry.js";
import {
	KONSUMEN,
	pointer,
	pump,
	readBrief,
	type SendDeps,
	sendTask,
} from "../../src/core/send.js";
import { tmuxTransport } from "../../src/core/transport.js";
import { startTmux, tmp, until } from "../helpers.js";

const BACA = (tujuan = "Cek halaman") =>
	`TUJUAN: ${tujuan}\nCAKUPAN: baca\nLANGKAH:\n1. Lihat.\nCEK: -\nBALASAN: hasil`;
const EDIT = (paths: string) =>
	`TUJUAN: Ubah kolom\nCAKUPAN: edit ${paths}\nLANGKAH:\n1. Ubah.\nCEK:\nyarn tsc -b\nBALASAN: hasil`;

async function siapkan(
	t: Parameters<typeof tmp>[0],
	nama = ["codex"],
	extra: Partial<SendDeps> = {},
) {
	const dir = tmp(t);
	const tmux = startTmux(t);
	const transport = tmuxTransport(tmux.opts);
	const registryFile = join(dir, "registry.json");
	const log = (n: string) => join(dir, `${n}.log`);
	for (const [i, n] of nama.entries()) {
		const sesi = String(i + 1);
		tmux.newFakeAgent(sesi, dir, ["normal", log(n)]);
		await until(() =>
			transport.layar(`${sesi}:0.0`).includes("fake-agent") ? true : undefined,
		);
		registerAgent(registryFile, {
			name: n,
			kind: "codex",
			tmux: `${sesi}:0.0`,
			capabilities: [],
		});
	}
	const ledger = Ledger.open(join(dir, "l.db"));
	t.after(() => ledger.close());
	const deps: SendDeps = {
		ledger,
		registryFile,
		repo: "/repo",
		transport,
		tmux: tmux.opts,
		...extra,
	};
	const diterima = (n: string) =>
		existsSync(log(n)) ? readFileSync(log(n), "utf8").trim().split("\n") : [];
	return { deps, ledger, tmux, diterima, registryFile };
}

test("pointer: satu baris, menyebut brief, reply, dan larangan git", () => {
	const p = pointer(12);
	assert.equal(p.includes("\n"), false);
	assert.match(p, /rempug brief T12/);
	assert.match(p, /rempug reply T12/);
	assert.match(p, /git commit, push, reset, checkout, stash/);
});

test("send mengembalikan ID, status berjalan, dan pointer sampai ke agent", async (t) => {
	const { deps, ledger, diterima } = await siapkan(t);
	const hasil = await sendTask(deps, { agent: "codex", brief: BACA() });
	assert.equal(hasil.status, "berjalan");
	assert.equal(ledger.getTask(hasil.id)?.status, "berjalan");
	await until(() => (diterima("codex").length ? true : undefined));
	assert.deepEqual(diterima("codex"), [pointer(hasil.id)]);
});

test("brief tidak lengkap ditolak dengan daftar kekurangan dan tidak membuat tugas", async (t) => {
	const { deps, ledger } = await siapkan(t);
	await assert.rejects(
		sendTask(deps, { agent: "codex", brief: "TUJUAN: saja" }),
		(e: Error) => /CAKUPAN/.test(e.message) && /CEK/.test(e.message),
	);
	assert.deepEqual(ledger.listTasks("/repo"), []);
});

test("agent tidak terdaftar, hilang, atau tidak andal ditolak", async (t) => {
	const { deps, tmux, registryFile } = await siapkan(t, ["codex", "agy"]);
	await assert.rejects(
		sendTask(deps, { agent: "tidak-ada", brief: BACA() }),
		/tidak terdaftar/,
	);
	tmux.killSession("2");
	await assert.rejects(
		sendTask(deps, { agent: "agy", brief: BACA() }),
		/hilang/,
	);
	updateAgent(registryFile, "codex", { tidakAndal: true });
	await assert.rejects(
		sendTask(deps, { agent: "codex", brief: BACA() }),
		/tidak andal/,
	);
});

test("agent sibuk ditolak kecuali --queue; antrean berjalan setelah tugas selesai", async (t) => {
	const { deps, ledger, diterima } = await siapkan(t);
	const a = await sendTask(deps, { agent: "codex", brief: BACA("satu") });
	await assert.rejects(
		sendTask(deps, { agent: "codex", brief: BACA("dua") }),
		/sibuk.*--queue/,
	);
	const b = await sendTask(deps, {
		agent: "codex",
		brief: BACA("dua"),
		queue: true,
	});
	assert.equal(b.status, "antri");
	assert.deepEqual(await pump(deps), []);

	ledger.setStatus(a.id, "selesai");
	assert.deepEqual(await pump(deps), [b.id]);
	assert.equal(ledger.getTask(b.id)?.status, "berjalan");
	await until(() => (diterima("codex").length >= 2 ? true : undefined));
	assert.equal(diterima("codex")[1], pointer(b.id));
});

test("--after menahan tugas sampai tugas yang disebut selesai; dibatalkan bila itu gagal", async (t) => {
	const { deps, ledger } = await siapkan(t, ["codex", "agy"]);
	const a = await sendTask(deps, { agent: "codex", brief: BACA("satu") });
	const b = await sendTask(deps, {
		agent: "agy",
		brief: BACA("dua"),
		afterId: a.id,
	});
	assert.equal(b.status, "antri");
	assert.deepEqual(await pump(deps), []);

	ledger.setStatus(a.id, "gagal");
	assert.deepEqual(await pump(deps), []);
	assert.equal(ledger.getTask(b.id)?.status, "gagal");
	const event = ledger.eventsAfter(0, "/repo").find((e) => e.taskId === b.id);
	assert.match(event?.line ?? "", /dibatalkan.*T1/);
});

test("--after ke tugas yang tidak ada atau sudah gagal ditolak", async (t) => {
	const { deps, ledger } = await siapkan(t, ["codex", "agy"]);
	await assert.rejects(
		sendTask(deps, { agent: "agy", brief: BACA(), afterId: 99 }),
		/T99/,
	);
	const a = await sendTask(deps, { agent: "codex", brief: BACA() });
	ledger.setStatus(a.id, "gagal");
	await assert.rejects(
		sendTask(deps, { agent: "agy", brief: BACA(), afterId: a.id }),
		/sudah gagal/,
	);
});

test("tugas edit yang cakupannya beririsan ditolak dan menyebut tugas lawan", async (t) => {
	const { deps } = await siapkan(t, ["codex", "agy"]);
	const a = await sendTask(deps, {
		agent: "codex",
		brief: EDIT("src/features/device/**"),
	});
	await assert.rejects(
		sendTask(deps, { agent: "agy", brief: EDIT("src/features/device/a.ts") }),
		(e: Error) => e.message.includes(`T${a.id}`) && /bentrok/.test(e.message),
	);
	const ok = await sendTask(deps, {
		agent: "agy",
		brief: EDIT("src/features/sim/**"),
	});
	assert.equal(ok.status, "berjalan");
});

test("tugas baca berjalan paralel dengan tugas edit mana pun", async (t) => {
	const { deps } = await siapkan(t, ["codex", "agy"]);
	await sendTask(deps, { agent: "codex", brief: EDIT("src/**") });
	const baca = await sendTask(deps, { agent: "agy", brief: BACA() });
	assert.equal(baca.status, "berjalan");
});

test("hook siapkan dipanggil sebelum pointer untuk tugas edit; galatnya menggagalkan tugas", async (t) => {
	const dipanggil: number[] = [];
	const { deps, ledger, diterima } = await siapkan(t, ["codex"], {
		siapkan: (task) => {
			dipanggil.push(task.id);
			assert.equal(diterima("codex").length, 0);
		},
	});
	const a = await sendTask(deps, { agent: "codex", brief: EDIT("src/**") });
	assert.deepEqual(dipanggil, [a.id]);

	ledger.setStatus(a.id, "selesai");
	deps.siapkan = () => {
		throw new Error("bukan repo git");
	};
	await assert.rejects(
		sendTask(deps, { agent: "codex", brief: EDIT("lib/**") }),
		/bukan repo git/,
	);
	assert.equal(ledger.listTasks("/repo").at(-1)?.status, "gagal");
});

test("peringatan watch muncul sampai konsumen terlihat aktif", async (t) => {
	const { deps, ledger } = await siapkan(t, ["codex", "agy"]);
	const a = await sendTask(deps, { agent: "codex", brief: BACA() });
	assert.match(a.peringatan ?? "", /rempug watch/);
	ledger.advanceConsumer(KONSUMEN, 0);
	const b = await sendTask(deps, { agent: "agy", brief: BACA() });
	assert.equal(b.peringatan, undefined);
});

test("readBrief menandai ack sekali, memuat brief, dan protokol sesuai mode", async (t) => {
	const { deps, ledger } = await siapkan(t, ["codex", "agy"]);
	const baca = await sendTask(deps, { agent: "codex", brief: BACA("Cek X") });
	const edit = await sendTask(deps, { agent: "agy", brief: EDIT("src/**") });

	assert.equal(ledger.getTask(baca.id)?.ackedAt, undefined);
	const teksBaca = readBrief(ledger, baca.id);
	const ack = ledger.getTask(baca.id)?.ackedAt;
	assert.ok(ack !== undefined);
	assert.match(teksBaca, /TUJUAN: Cek X/);
	assert.match(teksBaca, new RegExp(`rempug reply T${baca.id}`));
	assert.doesNotMatch(teksBaca, /rempug paham/);

	readBrief(ledger, baca.id);
	assert.equal(ledger.getTask(baca.id)?.ackedAt, ack);

	const teksEdit = readBrief(ledger, edit.id);
	assert.match(teksEdit, new RegExp(`rempug paham T${edit.id}`));
	assert.match(teksEdit, new RegExp(`rempug tunggu T${edit.id}`));
	assert.match(teksEdit, /Dilarang git commit/);
	assert.throws(() => readBrief(ledger, 999), /T999/);
});
