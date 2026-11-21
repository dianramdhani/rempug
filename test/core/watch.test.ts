import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Ledger } from "../../src/core/ledger.js";
import { KONSUMEN } from "../../src/core/send.js";
import { penandaTertunda, terima, watch } from "../../src/core/watch.js";
import { tmp, until } from "../helpers.js";

function siapkan(t: Parameters<typeof tmp>[0], now?: () => number) {
	const ledger = Ledger.open(join(tmp(t), "l.db"), { now });
	t.after(() => ledger.close());
	const id = ledger.createTask({
		repo: "/r",
		agent: "codex",
		mode: "baca",
		brief: "b",
	});
	const kejadian = (line: string) => ledger.addEvent(id, "selesai", line);
	const jalankan = (konsumen = KONSUMEN) => {
		const baris: string[] = [];
		const kontrol = new AbortController();
		const selesai = watch({
			ledger,
			repo: "/r",
			konsumen,
			tulis: (l) => baris.push(l),
			sinyal: kontrol.signal,
			intervalMs: 10,
		});
		return {
			baris,
			berhenti: async () => {
				kontrol.abort();
				await selesai;
			},
		};
	};
	return { ledger, kejadian, jalankan };
}

test("watch menyampaikan kejadian tertunda sekali dan berurutan, lalu yang baru", async (t) => {
	const { ledger, kejadian, jalankan } = siapkan(t);
	ledger.ensureConsumer(KONSUMEN, 0);
	kejadian("satu");
	kejadian("dua");
	const w = jalankan();
	await until(() => (w.baris.length === 2 ? true : undefined));
	kejadian("tiga");
	await until(() => (w.baris.length === 3 ? true : undefined));
	await new Promise((r) => setTimeout(r, 60));
	await w.berhenti();
	assert.deepEqual(w.baris, ["satu", "dua", "tiga"]);
});

test("watch tidak mencetak apa pun saat sepi (tanpa detak)", async (t) => {
	const { jalankan } = siapkan(t);
	const w = jalankan();
	await new Promise((r) => setTimeout(r, 120));
	await w.berhenti();
	assert.deepEqual(w.baris, []);
});

test("watch yang dipasang ulang menerima kejadian yang terlewat, bukan yang lama", async (t) => {
	const { ledger, kejadian, jalankan } = siapkan(t);
	ledger.ensureConsumer(KONSUMEN, 0);
	kejadian("lama");
	const pertama = jalankan();
	await until(() => (pertama.baris.length === 1 ? true : undefined));
	await pertama.berhenti();

	kejadian("terlewat-1");
	kejadian("terlewat-2");
	const kedua = jalankan();
	await until(() => (kedua.baris.length === 2 ? true : undefined));
	await kedua.berhenti();
	assert.deepEqual(kedua.baris, ["terlewat-1", "terlewat-2"]);
});

test("konsumen baru tanpa riwayat hanya menerima kejadian sesudah ia mulai", async (t) => {
	const { kejadian, jalankan } = siapkan(t);
	kejadian("riwayat lama");
	const w = jalankan("baru");
	await new Promise((r) => setTimeout(r, 60));
	kejadian("sesudah");
	await until(() => (w.baris.length === 1 ? true : undefined));
	await w.berhenti();
	assert.deepEqual(w.baris, ["sesudah"]);
});

test("dua konsumen masing-masing menerima semuanya", async (t) => {
	const { ledger, kejadian, jalankan } = siapkan(t);
	ledger.ensureConsumer("a", 0);
	ledger.ensureConsumer("b", 0);
	kejadian("x");
	kejadian("y");
	const a = jalankan("a");
	const b = jalankan("b");
	await until(() =>
		a.baris.length === 2 && b.baris.length === 2 ? true : undefined,
	);
	await Promise.all([a.berhenti(), b.berhenti()]);
	assert.deepEqual(a.baris, ["x", "y"]);
	assert.deepEqual(b.baris, ["x", "y"]);
});

test("watch menandai konsumen masih hidup walau sepi", async (t) => {
	let jam = 100;
	const { ledger, jalankan } = siapkan(t, () => jam);
	ledger.ensureConsumer(KONSUMEN, 0);
	assert.equal(ledger.getConsumer(KONSUMEN)?.lastSeen, undefined);
	const w = jalankan();
	await until(() =>
		ledger.getConsumer(KONSUMEN)?.lastSeen === 100 ? true : undefined,
	);
	jam = 105;
	await until(() =>
		ledger.getConsumer(KONSUMEN)?.lastSeen === 105 ? true : undefined,
	);
	await w.berhenti();
});

test("tiapSiklus dipanggil di setiap putaran", async (t) => {
	const { ledger } = siapkan(t);
	let n = 0;
	const kontrol = new AbortController();
	const selesai = watch({
		ledger,
		repo: "/r",
		tulis: () => {},
		sinyal: kontrol.signal,
		intervalMs: 10,
		tiapSiklus: () => void n++,
	});
	await until(() => (n >= 3 ? true : undefined));
	kontrol.abort();
	await selesai;
});

test("penandaTertunda dan terima: penanda muncul hanya bila ada yang tertunda", (t) => {
	const { ledger, kejadian } = siapkan(t);
	ledger.ensureConsumer(KONSUMEN, 0);
	assert.equal(penandaTertunda(ledger, "/r"), undefined);
	kejadian("a");
	kejadian("b");
	assert.match(
		penandaTertunda(ledger, "/r") ?? "",
		/^\[2 kejadian belum disampaikan.*rempug terima/,
	);
	assert.deepEqual(terima(ledger, "/r"), ["a", "b"]);
	assert.equal(penandaTertunda(ledger, "/r"), undefined);
	assert.deepEqual(terima(ledger, "/r"), []);
});

test("penandaTertunda tanpa konsumen terdaftar tidak mencetak apa pun", (t) => {
	const { kejadian, ledger } = siapkan(t);
	kejadian("a");
	assert.equal(penandaTertunda(ledger, "/r"), undefined);
});
