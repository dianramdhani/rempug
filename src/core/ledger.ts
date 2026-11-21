import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_RETENTION_DAYS = 30;

export type TaskMode = "edit" | "baca" | "browser";

export type TaskStatus =
	| "antri"
	| "berjalan"
	| "menunggu-klarifikasi"
	| "memverifikasi"
	| "selesai"
	| "gagal"
	| "gagal-paham"
	| "macet"
	| "bentrok"
	| "pelanggaran";

/** Status tempat tugas masih ada di tangan agent: memegang klaim cakupan dan membuat agent berstatus sibuk. */
export const ACTIVE_STATUSES: readonly TaskStatus[] = [
	"berjalan",
	"menunggu-klarifikasi",
	"memverifikasi",
];

export interface NewTask {
	repo: string;
	agent: string;
	mode: TaskMode;
	/** Path repo-relatif yang boleh disentuh; hanya untuk mode `edit`. */
	scope?: string[];
	brief: string;
	afterId?: number;
	headSha?: string;
	branch?: string;
	/** Selalu minta persetujuan orkestrator pada konfirmasi pemahaman. */
	teliti?: boolean;
	/** `berkas#nomor` item tasks.md yang dicentang saat verifikasi lulus. */
	centang?: string;
	/** Keluaran `git status --porcelain` saat tugas dikirim. */
	porcelain?: string;
}

export interface Task {
	id: number;
	repo: string;
	agent: string;
	mode: TaskMode;
	scope: string[] | undefined;
	status: TaskStatus;
	afterId: number | undefined;
	brief: string;
	headSha: string | undefined;
	branch: string | undefined;
	/** Detik sejak epoch. */
	sentAt: number;
	repliedAt: number | undefined;
	replySummary: string | undefined;
	replyDetail: string | undefined;
	/** Detik saat agent membaca brief (`rempug brief`). */
	ackedAt: number | undefined;
	/** Hasil verifikasi sebagai JSON. */
	verify: string | undefined;
	teliti: boolean;
	centang: string | undefined;
	/** Isi konfirmasi pemahaman terakhir dari agent. */
	paham: string | undefined;
	/** Jawaban orkestrator yang menunggu diambil agent lewat `rempug tunggu`. */
	jawaban: string | undefined;
	putaran: number;
	porcelain: string | undefined;
	scrHash: string | undefined;
	scrSince: number | undefined;
	/** Kejadian terakhir dari pemantau layar, supaya tidak dilaporkan berulang. */
	flag: string | undefined;
	upaya: number;
	pengingat: number;
}

/** Kolom yang boleh diubah lewat `Ledger.patch`. */
const PATCH_COLUMNS = {
	ackedAt: "acked_at",
	verify: "verify",
	paham: "paham",
	jawaban: "jawaban",
	putaran: "putaran",
	scrHash: "scr_hash",
	scrSince: "scr_since",
	flag: "flag",
	upaya: "upaya",
	pengingat: "pengingat",
} as const;

export type TaskPatch = Partial<
	Record<keyof typeof PATCH_COLUMNS, string | number | null>
>;

export interface Snapshot {
	path: string;
	hash: string;
	/** Isi berkas; `null` bila biner atau terlalu besar (hanya hash). */
	content: Uint8Array | null;
}

export interface Consumer {
	name: string;
	lastEventId: number;
	lastSeen: number | undefined;
}

export interface LedgerEvent {
	id: number;
	/** Detik sejak epoch. */
	ts: number;
	taskId: number;
	kind: string;
	line: string;
}

type Env = Record<string, string | undefined>;

/** Lokasi ledger; mengikuti `XDG_STATE_HOME`, jatuh ke `~/.local/state`. */
export function ledgerPath(env: Env = process.env): string {
	const state =
		env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
	return join(state, "rempug", "ledger.db");
}

/** Masa simpan dalam hari; `REMPUG_RETENTION_DAYS` harus bilangan bulat positif. */
export function retentionDays(env: Env = process.env): number {
	const raw = env.REMPUG_RETENTION_DAYS;
	return raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : DEFAULT_RETENTION_DAYS;
}

/** Tiap elemen adalah satu langkah migrasi; indeksnya + 1 adalah versi skema. */
export const MIGRASI: string[] = [
	`
	CREATE TABLE tasks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		repo TEXT NOT NULL,
		agent TEXT NOT NULL,
		mode TEXT NOT NULL CHECK (mode IN ('edit', 'baca', 'browser')),
		scope TEXT,
		status TEXT NOT NULL,
		after_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
		brief TEXT NOT NULL,
		head_sha TEXT,
		branch TEXT,
		sent_at INTEGER NOT NULL,
		replied_at INTEGER,
		reply_summary TEXT,
		reply_detail TEXT
	);
	CREATE INDEX tasks_repo_status ON tasks (repo, status);
	CREATE TABLE snapshots (
		task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
		path TEXT NOT NULL,
		hash TEXT NOT NULL,
		content BLOB,
		PRIMARY KEY (task_id, path)
	);
	CREATE TABLE events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ts INTEGER NOT NULL,
		task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
		kind TEXT NOT NULL,
		line TEXT NOT NULL
	);
	`,
	`
	ALTER TABLE tasks ADD COLUMN acked_at INTEGER;
	ALTER TABLE tasks ADD COLUMN verify TEXT;
	ALTER TABLE tasks ADD COLUMN teliti INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE tasks ADD COLUMN centang TEXT;
	ALTER TABLE tasks ADD COLUMN paham TEXT;
	ALTER TABLE tasks ADD COLUMN jawaban TEXT;
	ALTER TABLE tasks ADD COLUMN putaran INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE tasks ADD COLUMN porcelain TEXT;
	ALTER TABLE tasks ADD COLUMN scr_hash TEXT;
	ALTER TABLE tasks ADD COLUMN scr_since INTEGER;
	ALTER TABLE tasks ADD COLUMN flag TEXT;
	ALTER TABLE tasks ADD COLUMN upaya INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE tasks ADD COLUMN pengingat INTEGER NOT NULL DEFAULT 0;
	CREATE TABLE consumers (
		name TEXT PRIMARY KEY,
		last_event_id INTEGER NOT NULL DEFAULT 0,
		last_seen INTEGER
	);
	`,
];

function tidurSinkron(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * SQLite dapat mengembalikan SQLITE_BUSY seketika, tanpa menunggu `busy_timeout`, bila menunggu berisiko
 * deadlock (mis. dua proses beralih ke WAL pada berkas baru bersamaan). Satu-satunya jalan adalah mengulang.
 * Galat selain BUSY/LOCKED tidak diulang.
 */
export function ulangiBilaTerkunci<T>(fn: () => T, batasMs = 10_000): T {
	const akhir = Date.now() + batasMs;
	for (let i = 0; ; i++) {
		try {
			return fn();
		} catch (error) {
			const kode = (error as { errcode?: number }).errcode;
			const terkunci =
				kode === 5 ||
				kode === 6 ||
				/locked|busy/i.test((error as Error).message);
			if (!terkunci || Date.now() >= akhir) throw error;
			tidurSinkron(Math.min(5 * 2 ** Math.min(i, 5), 100));
		}
	}
}

function migrate(db: DatabaseSync): void {
	// IMMEDIATE: dua proses yang membuka ledger baru bersamaan harus antre, bukan sama-sama membuat tabel.
	db.exec("BEGIN IMMEDIATE");
	try {
		const row = db.prepare("PRAGMA user_version").get() as {
			user_version: number;
		};
		if (row.user_version > MIGRASI.length)
			throw new Error(
				`ledger ini dibuat oleh rempug versi lebih baru (skema ${row.user_version}, dikenal ${MIGRASI.length}); perbarui rempug.`,
			);
		for (let v = row.user_version; v < MIGRASI.length; v++)
			db.exec(MIGRASI[v] as string);
		db.exec(`PRAGMA user_version = ${MIGRASI.length}`);
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

type Row = Record<string, unknown>;

function toTask(row: Row): Task {
	return {
		id: row.id as number,
		repo: row.repo as string,
		agent: row.agent as string,
		mode: row.mode as TaskMode,
		scope: row.scope
			? (JSON.parse(row.scope as string) as string[])
			: undefined,
		status: row.status as TaskStatus,
		afterId: (row.after_id as number | null) ?? undefined,
		brief: row.brief as string,
		headSha: (row.head_sha as string | null) ?? undefined,
		branch: (row.branch as string | null) ?? undefined,
		sentAt: row.sent_at as number,
		repliedAt: (row.replied_at as number | null) ?? undefined,
		replySummary: (row.reply_summary as string | null) ?? undefined,
		replyDetail: (row.reply_detail as string | null) ?? undefined,
		ackedAt: (row.acked_at as number | null) ?? undefined,
		verify: (row.verify as string | null) ?? undefined,
		teliti: row.teliti === 1,
		centang: (row.centang as string | null) ?? undefined,
		paham: (row.paham as string | null) ?? undefined,
		jawaban: (row.jawaban as string | null) ?? undefined,
		putaran: row.putaran as number,
		porcelain: (row.porcelain as string | null) ?? undefined,
		scrHash: (row.scr_hash as string | null) ?? undefined,
		scrSince: (row.scr_since as number | null) ?? undefined,
		flag: (row.flag as string | null) ?? undefined,
		upaya: row.upaya as number,
		pengingat: row.pengingat as number,
	};
}

/** Ledger tugas dan event di satu berkas SQLite di luar repo proyek. */
export class Ledger {
	static readonly SCHEMA_VERSION = MIGRASI.length;

	readonly #db: DatabaseSync;
	readonly #now: () => number;

	private constructor(db: DatabaseSync, now: () => number) {
		this.#db = db;
		this.#now = now;
	}

	static open(
		path: string = ledgerPath(),
		options: { now?: () => number } = {},
	): Ledger {
		mkdirSync(dirname(path), { recursive: true });
		const db = new DatabaseSync(path);
		db.exec("PRAGMA busy_timeout = 5000");
		ulangiBilaTerkunci(() => db.exec("PRAGMA journal_mode = WAL"));
		db.exec("PRAGMA synchronous = NORMAL");
		db.exec("PRAGMA foreign_keys = ON");
		ulangiBilaTerkunci(() => migrate(db));
		return new Ledger(db, options.now ?? (() => Math.floor(Date.now() / 1000)));
	}

	close(): void {
		this.#db.close();
	}

	createTask(input: NewTask): number {
		const result = this.#db
			.prepare(
				`INSERT INTO tasks (repo, agent, mode, scope, status, after_id, brief, head_sha, branch, sent_at, teliti, centang, porcelain)
				 VALUES (?, ?, ?, ?, 'antri', ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.repo,
				input.agent,
				input.mode,
				input.scope ? JSON.stringify(input.scope) : null,
				input.afterId ?? null,
				input.brief,
				input.headSha ?? null,
				input.branch ?? null,
				this.#now(),
				input.teliti ? 1 : 0,
				input.centang ?? null,
				input.porcelain ?? null,
			);
		return Number(result.lastInsertRowid);
	}

	getTask(id: number): Task | undefined {
		const row = this.#db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
		return row ? toTask(row) : undefined;
	}

	listTasks(repo: string): Task[] {
		return this.#db
			.prepare("SELECT * FROM tasks WHERE repo = ? ORDER BY id")
			.all(repo)
			.map(toTask);
	}

	/** Tugas `edit` yang masih memegang klaim cakupan di repo ini. */
	activeEditTasks(repo: string): Task[] {
		const marks = ACTIVE_STATUSES.map(() => "?").join(", ");
		return this.#db
			.prepare(
				`SELECT * FROM tasks WHERE repo = ? AND mode = 'edit' AND status IN (${marks}) ORDER BY id`,
			)
			.all(repo, ...ACTIVE_STATUSES)
			.map(toTask);
	}

	/** Tugas aktif terbaru milik agent ini di repo mana pun, bila ada. */
	activeTaskOf(agent: string): Task | undefined {
		const marks = ACTIVE_STATUSES.map(() => "?").join(", ");
		const row = this.#db
			.prepare(
				`SELECT * FROM tasks WHERE agent = ? AND status IN (${marks}) ORDER BY id DESC LIMIT 1`,
			)
			.get(agent, ...ACTIVE_STATUSES);
		return row ? toTask(row) : undefined;
	}

	/** Menghapus tugas beserta snapshot dan event-nya (mis. tugas uji probe). */
	deleteTask(id: number): void {
		this.#db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
	}

	/** Tugas repo ini dengan status tertentu, berurutan menurut ID. */
	tasksWhere(repo: string, statuses: readonly TaskStatus[]): Task[] {
		const marks = statuses.map(() => "?").join(", ");
		return this.#db
			.prepare(
				`SELECT * FROM tasks WHERE repo = ? AND status IN (${marks}) ORDER BY id`,
			)
			.all(repo, ...statuses)
			.map(toTask);
	}

	/** Mengubah kolom tertentu; galat bila tugas tidak ada. */
	patch(id: number, fields: TaskPatch): void {
		const entries = Object.entries(fields) as [
			keyof TaskPatch,
			string | number | null | undefined,
		][];
		if (entries.length === 0) return;
		const sets = entries.map(([k]) => `${PATCH_COLUMNS[k]} = ?`).join(", ");
		const result = this.#db
			.prepare(`UPDATE tasks SET ${sets} WHERE id = ?`)
			.run(...entries.map(([, v]) => v ?? null), id);
		if (result.changes === 0) throw new Error(`tugas T${id} tidak ada`);
	}

	/** Menandai brief sudah dibaca agent; `true` hanya pada pembacaan pertama. */
	markAcked(id: number): boolean {
		const result = this.#db
			.prepare(
				"UPDATE tasks SET acked_at = ? WHERE id = ? AND acked_at IS NULL",
			)
			.run(this.#now(), id);
		return result.changes > 0;
	}

	addSnapshot(
		taskId: number,
		path: string,
		hash: string,
		content: Uint8Array | null,
	): void {
		this.#db
			.prepare(
				"INSERT OR REPLACE INTO snapshots (task_id, path, hash, content) VALUES (?, ?, ?, ?)",
			)
			.run(taskId, path, hash, content);
	}

	getSnapshots(taskId: number): Snapshot[] {
		return this.#db
			.prepare(
				"SELECT path, hash, content FROM snapshots WHERE task_id = ? ORDER BY path",
			)
			.all(taskId)
			.map((row) => ({
				path: row.path as string,
				hash: row.hash as string,
				content: (row.content as Uint8Array | null) ?? null,
			}));
	}

	/** Membuat konsumen kejadian bila belum ada; kursor awal tidak menimpa yang sudah ada. */
	ensureConsumer(name: string, cursor: number): void {
		this.#db
			.prepare(
				"INSERT OR IGNORE INTO consumers (name, last_event_id) VALUES (?, ?)",
			)
			.run(name, cursor);
	}

	getConsumer(name: string): Consumer | undefined {
		const row = this.#db
			.prepare("SELECT * FROM consumers WHERE name = ?")
			.get(name);
		return row
			? {
					name: row.name as string,
					lastEventId: row.last_event_id as number,
					lastSeen: (row.last_seen as number | null) ?? undefined,
				}
			: undefined;
	}

	/** Memajukan kursor (tidak pernah mundur) dan mencatat waktu terakhir terlihat. */
	advanceConsumer(name: string, eventId: number): void {
		this.#db
			.prepare(
				"UPDATE consumers SET last_event_id = MAX(last_event_id, ?), last_seen = ? WHERE name = ?",
			)
			.run(eventId, this.#now(), name);
	}

	/** Mencatat bahwa konsumen masih hidup tanpa menggeser kursor. */
	touchConsumer(name: string): void {
		this.#db
			.prepare("UPDATE consumers SET last_seen = ? WHERE name = ?")
			.run(this.#now(), name);
	}

	/** ID event terbesar di repo ini; 0 bila belum ada. */
	maxEventId(repo: string): number {
		const row = this.#db
			.prepare(
				`SELECT COALESCE(MAX(e.id), 0) AS id FROM events e JOIN tasks t ON t.id = e.task_id WHERE t.repo = ?`,
			)
			.get(repo) as { id: number };
		return row.id;
	}

	/** Waktu sekarang menurut jam ledger (detik); dipakai bersama agar uji dapat mengatur jam. */
	now(): number {
		return this.#now();
	}

	setStatus(id: number, status: TaskStatus): void {
		const result = this.#db
			.prepare("UPDATE tasks SET status = ? WHERE id = ?")
			.run(status, id);
		if (result.changes === 0) throw new Error(`tugas T${id} tidak ada`);
	}

	saveReply(id: number, summary: string, detail: string): void {
		const result = this.#db
			.prepare(
				"UPDATE tasks SET reply_summary = ?, reply_detail = ?, replied_at = ? WHERE id = ?",
			)
			.run(summary, detail, this.#now(), id);
		if (result.changes === 0) throw new Error(`tugas T${id} tidak ada`);
	}

	addEvent(taskId: number, kind: string, line: string): number {
		const result = this.#db
			.prepare(
				"INSERT INTO events (ts, task_id, kind, line) VALUES (?, ?, ?, ?)",
			)
			.run(this.#now(), taskId, kind, line);
		return Number(result.lastInsertRowid);
	}

	/** Event repo ini dengan id lebih besar dari `afterId`, berurutan. */
	eventsAfter(afterId: number, repo: string): LedgerEvent[] {
		return this.#db
			.prepare(
				`SELECT e.id, e.ts, e.task_id, e.kind, e.line
				 FROM events e JOIN tasks t ON t.id = e.task_id
				 WHERE e.id > ? AND t.repo = ? ORDER BY e.id`,
			)
			.all(afterId, repo)
			.map((row) => ({
				id: row.id as number,
				ts: row.ts as number,
				taskId: row.task_id as number,
				kind: row.kind as string,
				line: row.line as string,
			}));
	}

	/** Menghapus tugas lebih tua dari `days` hari (snapshot dan event ikut terhapus); mengembalikan jumlahnya. */
	purgeOlderThan(days: number): number {
		return Number(
			this.#db
				.prepare("DELETE FROM tasks WHERE sent_at < ?")
				.run(this.#now() - days * 86_400).changes,
		);
	}
}
