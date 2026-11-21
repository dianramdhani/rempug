import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { promisify } from "node:util";
import {
	DEFAULT_RETENTION_DAYS,
	Ledger,
	ledgerPath,
	retentionDays,
	ulangiBilaTerkunci,
} from "../../src/core/ledger.js";
import { tmp } from "../helpers.js";

const run = promisify(execFile);
const DAY = 86_400;

test("ledgerPath mengikuti XDG_STATE_HOME, lalu HOME", () => {
	assert.equal(ledgerPath({ XDG_STATE_HOME: "/x" }), "/x/rempug/ledger.db");
	assert.equal(ledgerPath({ HOME: "/h" }), "/h/.local/state/rempug/ledger.db");
});

test("open membuat direktori dan berkas, mode WAL, dan versi skema", (t) => {
	const path = join(tmp(t), "a", "b", "ledger.db");
	Ledger.open(path).close();
	assert.ok(existsSync(path));
	const raw = new DatabaseSync(path);
	t.after(() => raw.close());
	assert.deepEqual(
		{ ...raw.prepare("PRAGMA journal_mode").get() },
		{ journal_mode: "wal" },
	);
	assert.deepEqual(
		{ ...raw.prepare("PRAGMA user_version").get() },
		{ user_version: Ledger.SCHEMA_VERSION },
	);
});

test("membuka ulang tidak merusak data", (t) => {
	const path = join(tmp(t), "ledger.db");
	const first = Ledger.open(path);
	const id = first.createTask({
		repo: "/r",
		agent: "codex",
		mode: "baca",
		brief: "b",
	});
	first.close();
	const second = Ledger.open(path);
	t.after(() => second.close());
	assert.equal(second.getTask(id)?.brief, "b");
});

test("menolak ledger yang dibuat versi rempug lebih baru", (t) => {
	const path = join(tmp(t), "ledger.db");
	Ledger.open(path).close();
	const raw = new DatabaseSync(path);
	raw.exec("PRAGMA user_version = 99");
	raw.close();
	assert.throws(() => Ledger.open(path), /lebih baru/);
});

test("dua proses menulis bersamaan tanpa gagal dan ID unik", async (t) => {
	const path = join(tmp(t), "ledger.db");
	const moduleUrl = new URL("../../src/core/ledger.js", import.meta.url).href;
	const code = `
		const { Ledger } = await import(process.argv[1]);
		const l = Ledger.open(process.argv[2]);
		for (let i = 0; i < 50; i++)
			l.createTask({ repo: "/r", agent: process.argv[3], mode: "baca", brief: "b" + i });
		l.close();
	`;
	const child = (agent: string) =>
		run(process.execPath, [
			"--input-type=module",
			"-e",
			code,
			moduleUrl,
			path,
			agent,
		]);
	await Promise.all([child("a"), child("b")]);
	const ledger = Ledger.open(path);
	t.after(() => ledger.close());
	const ids = ledger.listTasks("/r").map((task) => task.id);
	assert.equal(ids.length, 100);
	assert.equal(new Set(ids).size, 100);
});

test("createTask memberi ID naik dan menyimpan bidang dengan benar", (t) => {
	const ledger = Ledger.open(join(tmp(t), "l.db"), { now: () => 1000 });
	t.after(() => ledger.close());
	const a = ledger.createTask({
		repo: "/r",
		agent: "codex",
		mode: "edit",
		scope: ["src/a/**", "src/b.ts"],
		brief: "satu",
		headSha: "abc",
		branch: "dev",
	});
	const b = ledger.createTask({
		repo: "/r",
		agent: "agy",
		mode: "baca",
		brief: "dua",
		afterId: a,
	});
	assert.ok(b > a);
	assert.deepEqual(ledger.getTask(a), {
		id: a,
		repo: "/r",
		agent: "codex",
		mode: "edit",
		scope: ["src/a/**", "src/b.ts"],
		status: "antri",
		afterId: undefined,
		brief: "satu",
		headSha: "abc",
		branch: "dev",
		sentAt: 1000,
		repliedAt: undefined,
		replySummary: undefined,
		replyDetail: undefined,
		ackedAt: undefined,
		verify: undefined,
		teliti: false,
		centang: undefined,
		paham: undefined,
		jawaban: undefined,
		putaran: 0,
		porcelain: undefined,
		scrHash: undefined,
		scrSince: undefined,
		flag: undefined,
		upaya: 0,
		pengingat: 0,
	});
	assert.equal(ledger.getTask(b)?.afterId, a);
	assert.equal(ledger.getTask(b)?.scope, undefined);
	assert.equal(ledger.getTask(9999), undefined);
});

test("setStatus dan saveReply mengubah tugas; ID tidak ada melempar galat", (t) => {
	let clock = 100;
	const ledger = Ledger.open(join(tmp(t), "l.db"), { now: () => clock });
	t.after(() => ledger.close());
	const id = ledger.createTask({
		repo: "/r",
		agent: "codex",
		mode: "baca",
		brief: "b",
	});
	ledger.setStatus(id, "berjalan");
	assert.equal(ledger.getTask(id)?.status, "berjalan");
	clock = 160;
	ledger.saveReply(id, "ringkas", "rinci");
	const task = ledger.getTask(id);
	assert.equal(task?.replySummary, "ringkas");
	assert.equal(task?.replyDetail, "rinci");
	assert.equal(task?.repliedAt, 160);
	assert.throws(() => ledger.setStatus(999, "selesai"), /T999/);
	assert.throws(() => ledger.saveReply(999, "a", "b"), /T999/);
});

test("event dibaca berurutan dan hanya yang lebih baru dari kursor", (t) => {
	const ledger = Ledger.open(join(tmp(t), "l.db"), { now: () => 5 });
	t.after(() => ledger.close());
	const id = ledger.createTask({
		repo: "/r",
		agent: "codex",
		mode: "baca",
		brief: "b",
	});
	const e1 = ledger.addEvent(id, "selesai", "T1 selesai");
	const e2 = ledger.addEvent(id, "macet", "T1 macet");
	assert.ok(e2 > e1);
	assert.deepEqual(ledger.eventsAfter(0, "/r"), [
		{ id: e1, ts: 5, taskId: id, kind: "selesai", line: "T1 selesai" },
		{ id: e2, ts: 5, taskId: id, kind: "macet", line: "T1 macet" },
	]);
	assert.deepEqual(
		ledger.eventsAfter(e1, "/r").map((e) => e.id),
		[e2],
	);
	assert.deepEqual(ledger.eventsAfter(e2, "/r"), []);
});

test("tugas dan event dipisah per repo", (t) => {
	const ledger = Ledger.open(join(tmp(t), "l.db"));
	t.after(() => ledger.close());
	const a = ledger.createTask({
		repo: "/a",
		agent: "x",
		mode: "baca",
		brief: "b",
	});
	const b = ledger.createTask({
		repo: "/b",
		agent: "x",
		mode: "baca",
		brief: "b",
	});
	ledger.addEvent(a, "selesai", "A");
	ledger.addEvent(b, "selesai", "B");
	assert.deepEqual(
		ledger.listTasks("/a").map((task) => task.id),
		[a],
	);
	assert.deepEqual(
		ledger.eventsAfter(0, "/b").map((e) => e.line),
		["B"],
	);
});

test("activeEditTasks hanya tugas edit yang memegang klaim", (t) => {
	const ledger = Ledger.open(join(tmp(t), "l.db"));
	t.after(() => ledger.close());
	const mk = (
		mode: "edit" | "baca",
		status: Parameters<Ledger["setStatus"]>[1],
	) => {
		const id = ledger.createTask({
			repo: "/r",
			agent: "x",
			mode,
			scope: mode === "edit" ? ["src"] : undefined,
			brief: "b",
		});
		ledger.setStatus(id, status);
		return id;
	};
	const berjalan = mk("edit", "berjalan");
	const verifikasi = mk("edit", "memverifikasi");
	const klarifikasi = mk("edit", "menunggu-klarifikasi");
	mk("edit", "antri");
	mk("edit", "selesai");
	mk("edit", "gagal");
	mk("baca", "berjalan");
	assert.deepEqual(
		ledger.activeEditTasks("/r").map((task) => task.id),
		[berjalan, verifikasi, klarifikasi],
	);
	assert.deepEqual(ledger.activeEditTasks("/lain"), []);
});

test("purgeOlderThan menghapus tugas lama beserta snapshot dan event-nya", (t) => {
	let clock = 1_000_000;
	const path = join(tmp(t), "l.db");
	const ledger = Ledger.open(path, { now: () => clock });
	t.after(() => ledger.close());
	const lama = ledger.createTask({
		repo: "/r",
		agent: "x",
		mode: "baca",
		brief: "lama",
	});
	ledger.addEvent(lama, "selesai", "lama");
	const raw = new DatabaseSync(path);
	t.after(() => raw.close());
	raw
		.prepare("INSERT INTO snapshots (task_id, path, hash) VALUES (?, ?, ?)")
		.run(lama, "a.ts", "h");

	clock += 31 * DAY;
	const baru = ledger.createTask({
		repo: "/r",
		agent: "x",
		mode: "baca",
		brief: "baru",
	});

	assert.equal(ledger.purgeOlderThan(30), 1);
	assert.equal(ledger.getTask(lama), undefined);
	assert.ok(ledger.getTask(baru));
	const count = (table: string) =>
		(raw.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number })
			.c;
	assert.equal(count("snapshots"), 0);
	assert.equal(count("events"), 0);
});

test("retentionDays: bawaan 30, dapat diatur lewat env, nilai tidak valid diabaikan", () => {
	assert.equal(DEFAULT_RETENTION_DAYS, 30);
	assert.equal(retentionDays({}), 30);
	assert.equal(retentionDays({ REMPUG_RETENTION_DAYS: "7" }), 7);
	for (const bad of ["abc", "0", "-3", "1.5", ""]) {
		assert.equal(retentionDays({ REMPUG_RETENTION_DAYS: bad }), 30, bad);
	}
});

test("ulangiBilaTerkunci mengulang SQLITE_BUSY lalu berhasil, tetapi tidak galat lain", () => {
	let n = 0;
	const sibuk = () =>
		Object.assign(new Error("database is locked"), { errcode: 5 });
	assert.equal(
		ulangiBilaTerkunci(() => {
			if (++n < 3) throw sibuk();
			return "ok";
		}),
		"ok",
	);
	assert.equal(n, 3);

	let m = 0;
	assert.throws(
		() =>
			ulangiBilaTerkunci(() => {
				m++;
				throw new Error("bukan soal kunci");
			}),
		/bukan soal kunci/,
	);
	assert.equal(m, 1, "galat selain BUSY tidak boleh diulang");
});

test("ulangiBilaTerkunci menyerah setelah batas waktu", () => {
	const mulai = Date.now();
	assert.throws(
		() =>
			ulangiBilaTerkunci(() => {
				throw Object.assign(new Error("database is locked"), { errcode: 5 });
			}, 150),
		/locked/,
	);
	assert.ok(Date.now() - mulai < 2000);
});
