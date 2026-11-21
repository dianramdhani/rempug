import assert from "node:assert/strict";
import { test } from "node:test";
import { bangunkan } from "../../src/core/bangun.js";
import type { Transport } from "../../src/core/transport.js";

function transportPalsu(layar: () => string[]) {
	const terkirim: string[] = [];
	const transport = {
		tampak: () => ({ baris: layar(), kursorY: 0 }),
		kirim: async (_t: string, baris: string) => void terkirim.push(baris),
	} as unknown as Transport;
	return { transport, terkirim };
}

test("mengetik satu baris ke pane orkestrator bila pane itu idle", async () => {
	const { transport, terkirim } = transportPalsu(() => ["> "]);
	assert.equal(
		await bangunkan({
			transport,
			target: "0:0.1",
			baris: "T1 selesai",
			jedaMs: 1,
		}),
		true,
	);
	assert.deepEqual(terkirim, ["[rempug] T1 selesai"]);
});

test("tidak mengetik saat pane sibuk (layar berubah)", async () => {
	let n = 0;
	const { transport, terkirim } = transportPalsu(() => [`kerja ${n++}x`]);
	assert.equal(
		await bangunkan({
			transport,
			target: "0:0.1",
			baris: "T1 selesai",
			jedaMs: 1,
		}),
		false,
	);
	assert.deepEqual(terkirim, []);
});

test("galat saat membaca layar dianggap sibuk, bukan dilempar", async () => {
	const transport = {
		tampak: () => {
			throw new Error("pane hilang");
		},
		kirim: async () => {
			throw new Error("tidak boleh dipanggil");
		},
	} as unknown as Transport;
	assert.equal(
		await bangunkan({ transport, target: "x", baris: "a", jedaMs: 1 }),
		false,
	);
});
