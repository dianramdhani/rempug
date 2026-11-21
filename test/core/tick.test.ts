import assert from "node:assert/strict";
import { test } from "node:test";
import { readAgents } from "../../src/core/registry.js";
import { type SendDeps, sendTask } from "../../src/core/send.js";
import { tick } from "../../src/core/tick.js";
import { type SpesAgen, ujiAgen, until } from "../helpers.js";

const BACA =
	"TUJUAN: Cek\nCAKUPAN: baca\nLANGKAH:\n1. Lihat.\nCEK: -\nBALASAN: hasil";
const OPSI = { ackDetik: 5, diamDetik: 2, macetDetik: 30 };

async function mulai(
	t: Parameters<typeof ujiAgen>[0],
	env: Record<string, string> = {},
	spes: Partial<SpesAgen> = {},
) {
	let jam = 1000;
	const h = await ujiAgen(t, [{ name: "codex", env, ...spes }], {
		now: () => jam,
	});
	const deps: SendDeps = {
		ledger: h.ledger,
		registryFile: h.registryFile,
		repo: "/repo",
		transport: h.transport,
		tmux: h.tmux.opts,
	};
	const { id } = await sendTask(deps, { agent: "codex", brief: BACA });
	// Tunggu sampai agent palsu benar-benar MEMPROSES pointer: berkasnya tercatat, lalu layar berhenti berubah.
	// Teks yang baru terlihat di kotak input belum berarti Enter sudah diproses (di CI yang lambat selisihnya terasa).
	// Pengecualian FAKE_NOENTER: Enter memang tidak pernah diproses, jadi cukup menunggu teksnya tampak.
	if (env.FAKE_NOENTER)
		await until(() =>
			h.transport
				.layar("1:0.0")
				.replace(/\s+/g, "")
				.includes(`rempugbriefT${id}`)
				? true
				: undefined,
		);
	else {
		await until(() => (h.diterima("codex").length ? true : undefined));
		let terakhir = "";
		await until(() => {
			const kini = h.transport.layar("1:0.0");
			const sama = kini === terakhir;
			terakhir = kini;
			return sama ? true : undefined;
		});
	}
	const maju = (detik: number) => {
		jam += detik;
	};
	const jalan = () => tick({ ...deps, opsi: OPSI });
	const status = () => h.ledger.getTask(id)?.status;
	return { ...h, deps, id, maju, jalan, status };
}

test("sebelum batas ack tidak ada reaksi", async (t) => {
	const m = await mulai(t, { FAKE_NOENTER: "1" });
	assert.deepEqual(await m.jalan(), []);
	assert.equal(m.ledger.getTask(m.id)?.upaya, 0);
});

test("teks tertahan: submit diulang, lalu profil lain, lalu tersangkut dan agent ditandai gagal", async (t) => {
	const m = await mulai(t, { FAKE_NOENTER: "1" });
	await m.jalan();
	for (const upaya of [1, 2, 3]) {
		m.maju(10);
		assert.deepEqual(await m.jalan(), [], `upaya ${upaya}`);
		assert.equal(m.ledger.getTask(m.id)?.upaya, upaya);
	}
	m.maju(10);
	const baris = await m.jalan();
	assert.equal(baris.length, 1);
	assert.match(
		baris[0] ?? "",
		new RegExp(`^T${m.id} codex tersangkut: .*3 percobaan`),
	);
	assert.equal(m.status(), "macet");
	assert.equal(m.ledger.eventsAfter(0, "/repo").at(-1)?.kind, "tersangkut");
	assert.equal(readAgents(m.registryFile)[0]?.gagalBeruntun, 1);
});

test("pointer diterima tetapi tidak ada ack: dilaporkan sekali, tidak dikirim ulang", async (t) => {
	const m = await mulai(t);
	await m.jalan();
	m.maju(10);
	const [baris] = await m.jalan();
	assert.match(baris ?? "", new RegExp(`^T${m.id} codex diterima-tanpa-ack`));
	m.maju(10);
	assert.deepEqual(await m.jalan(), []);
	assert.equal(m.status(), "berjalan");
	assert.equal(m.diterima("codex").length, 1);
});

test("prompt izin sebelum ack dilaporkan sebagai menunggu-izin, bukan tanpa-ack", async (t) => {
	const m = await mulai(t, { FAKE_AFTER: "izin", FAKE_LAMBAT_MS: "400" });
	await m.jalan();
	m.maju(10);
	const [baris] = await m.jalan();
	assert.match(baris ?? "", new RegExp(`^T${m.id} codex menunggu-izin`));
	assert.match(baris ?? "", /1:0\.0/);
	m.maju(10);
	assert.deepEqual(await m.jalan(), []);
});

test("setelah ack: pertanyaan agent dilaporkan sekali beserta cara menjawab", async (t) => {
	const m = await mulai(t, { FAKE_AFTER: "ask", FAKE_LAMBAT_MS: "400" });
	m.ledger.markAcked(m.id);
	m.maju(10);
	const [baris] = await m.jalan();
	assert.match(
		baris ?? "",
		new RegExp(
			`^T${m.id} codex bertanya: Which option do you prefer, A or B\\?`,
		),
	);
	assert.match(baris ?? "", /rempug jawab/);
	m.maju(10);
	assert.deepEqual(await m.jalan(), []);
});

test("setelah ack: limit membuat tugas macet dengan kejadian limit", async (t) => {
	const m = await mulai(t, { FAKE_AFTER: "limit", FAKE_LAMBAT_MS: "400" });
	m.ledger.markAcked(m.id);
	m.maju(10);
	const [baris] = await m.jalan();
	assert.match(baris ?? "", new RegExp(`^T${m.id} codex limit`));
	assert.equal(m.status(), "macet");
	assert.equal(m.ledger.eventsAfter(0, "/repo").at(-1)?.kind, "limit");
});

test("setelah ack: izin dilaporkan sekali untuk manusia dan tidak dijawab", async (t) => {
	const m = await mulai(t, { FAKE_AFTER: "izin", FAKE_LAMBAT_MS: "400" });
	m.ledger.markAcked(m.id);
	m.maju(10);
	const [baris] = await m.jalan();
	assert.match(baris ?? "", new RegExp(`^T${m.id} codex menunggu-izin`));
	m.maju(10);
	assert.deepEqual(await m.jalan(), []);
	assert.equal(m.diterima("codex").length, 1);
	assert.equal(m.status(), "berjalan");
});

test("selesai tanpa membalas: satu pengingat, lalu macet", async (t) => {
	const m = await mulai(t);
	m.ledger.markAcked(m.id);
	await m.jalan();
	m.maju(10);
	assert.deepEqual(await m.jalan(), []);
	await until(() => (m.diterima("codex").length === 2 ? true : undefined));
	assert.match(
		m.diterima("codex")[1] ?? "",
		new RegExp(
			`Pengingat: tugas T${m.id} belum dibalas.*rempug reply T${m.id}`,
		),
	);
	assert.equal(m.ledger.getTask(m.id)?.pengingat, 1);

	m.maju(10);
	assert.deepEqual(await m.jalan(), []);
	m.maju(35);
	const [baris] = await m.jalan();
	assert.match(baris ?? "", new RegExp(`^T${m.id} codex macet`));
	assert.equal(m.status(), "macet");
	assert.equal(m.diterima("codex").length, 2);
});

test("sesi agent hilang membuat tugas macet", async (t) => {
	const m = await mulai(t);
	m.tmux.killSession("1");
	const [baris] = await m.jalan();
	assert.match(baris ?? "", new RegExp(`^T${m.id} codex macet: agent hilang`));
	assert.equal(m.status(), "macet");
});

test("hanya tugas berjalan yang dipantau", async (t) => {
	const m = await mulai(t, { FAKE_NOENTER: "1" });
	m.ledger.setStatus(m.id, "menunggu-klarifikasi");
	m.maju(100);
	assert.deepEqual(await m.jalan(), []);
	assert.equal(m.ledger.getTask(m.id)?.upaya, 0);
});
