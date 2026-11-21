import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { gitRepo, startTmux, tmp, until, untilAsync } from "./helpers.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const BACA =
	"TUJUAN: Cek\nCAKUPAN: baca\nLANGKAH:\n1. Lihat.\nCEK: -\nBALASAN: hasil";

async function mulaiServer(t: Parameters<typeof tmp>[0]) {
	const dir = tmp(t);
	const repo = gitRepo(t);
	const tmux = startTmux(t);
	const env = {
		...Object.fromEntries(
			Object.entries(process.env).filter(([, v]) => v !== undefined),
		),
		XDG_STATE_HOME: join(dir, "state"),
		XDG_CONFIG_HOME: join(dir, "config"),
		REMPUG_TMUX_SOCKET: tmux.opts.socket as string,
	} as Record<string, string>;
	delete env.TMUX;
	const client = new Client({ name: "uji", version: "0.0.0" });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: [cli, "mcp"],
			env,
			cwd: repo,
			stderr: "ignore",
		}),
	);
	t.after(() => client.close());
	const panggil = async (name: string, args: Record<string, unknown> = {}) => {
		const hasil = (await client.callTool({ name, arguments: args })) as {
			content: { type: string; text: string }[];
			isError?: boolean;
		};
		return {
			teks: hasil.content.map((c) => c.text).join("\n"),
			galat: hasil.isError === true,
		};
	};
	return { client, panggil, tmux, repo, dir };
}

test("server mengekspos tool yang sama dengan CLI, tanpa watch, dan skemanya ringkas", async (t) => {
	const { client } = await mulaiServer(t);
	const { tools } = await client.listTools();
	const nama = tools.map((x) => x.name).sort();
	for (const wajib of [
		"send",
		"brief",
		"paham",
		"tunggu",
		"jawab",
		"reply",
		"ls",
		"log",
		"show",
		"diff",
		"report",
		"layar",
		"scan",
		"register",
		"probe",
		"status",
		"terima",
	])
		assert.ok(nama.includes(wajib), `tool ${wajib} tidak ada`);
	assert.equal(nama.includes("watch"), false);
	for (const x of tools) {
		assert.ok(
			x.description && x.description.length > 10,
			`${x.name} tanpa deskripsi`,
		);
		assert.equal(x.inputSchema.type, "object");
	}
	// Biaya token saat tool dimuat: skema seluruh tool harus tetap kecil.
	assert.ok(
		JSON.stringify(tools).length < 9000,
		`skema terlalu besar: ${JSON.stringify(tools).length}`,
	);
});

test("hasil tool sama dengan perintah CLI yang setara", async (t) => {
	const { panggil } = await mulaiServer(t);
	assert.equal((await panggil("log")).teks, "belum ada tugas");
	assert.equal(
		(await panggil("status")).teks,
		"rempug: belum ada agent; jalankan /rempug",
	);
	assert.equal(
		(await panggil("ls")).teks,
		"belum ada agent terdaftar; jalankan /rempug",
	);
	assert.match((await panggil("report")).teks, /belum ada tugas/);
});

test("kesalahan pemakaian menjadi isError dan pesannya sampai", async (t) => {
	const { panggil } = await mulaiServer(t);
	const r = await panggil("send", { agent: "x", brief: "TUJUAN: saja" });
	assert.equal(r.galat, true);
	assert.match(r.teks, /CAKUPAN/);
	const hilang = await panggil("show", { id: 99 });
	assert.equal(hilang.galat, true);
	assert.match(hilang.teks, /T99/);
});

test("alur lengkap lewat MCP, termasuk verifikasi terlepas oleh proses CLI sungguhan", async (t) => {
	const { panggil, tmux, repo, dir } = await mulaiServer(t);
	tmux.newFakeAgent("1", repo, ["normal", join(dir, "agy.log")]);
	await until(() => (tmux.opts.socket ? true : undefined));

	const daftar = await panggil("register", {
		nama: "agy",
		target: "1:0.0",
		jenis: "agy",
		tanpaProbe: true,
	});
	assert.equal(daftar.galat, false, daftar.teks);
	assert.match((await panggil("ls")).teks, /agy\s+siap/);

	assert.match(
		(await panggil("send", { agent: "agy", brief: BACA })).teks,
		/^T1 berjalan/,
	);
	assert.match((await panggil("brief", { id: 1 })).teks, /TUJUAN: Cek/);
	assert.match(
		(await panggil("reply", { id: 1, isi: "HASIL: beres" })).teks,
		/OK T1 diterima/,
	);

	const log = await untilAsync(async () => {
		const r = await panggil("log");
		return /✓ baca/.test(r.teks) ? r.teks : undefined;
	}, 15_000);
	assert.match(log, /T1 agy ✓ baca \| HASIL: beres/);
	assert.match(
		(await panggil("show", { id: 1, penuh: true })).teks,
		/balasan lengkap:/,
	);
});
