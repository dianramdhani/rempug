import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import {
	agentRows,
	formatAgentRow,
	register,
	requireAvailable,
} from "../../src/core/agents.js";
import { Ledger } from "../../src/core/ledger.js";
import { readAgents } from "../../src/core/registry.js";
import { startTmux, tmp, until } from "../helpers.js";

async function siapkan(t: Parameters<typeof tmp>[0]) {
	const dir = tmp(t);
	const tmux = startTmux(t);
	tmux.newSession("1", dir, "agy");
	tmux.newSession("2", dir, "codex");
	await until(() => (agentRowsKosong(tmux.opts) === 2 ? true : undefined));
	return {
		dir,
		tmux,
		file: join(dir, "registry.json"),
		ledger: Ledger.open(join(dir, "ledger.db")),
	};
}

import { listPanes } from "../../src/core/tmux.js";

function agentRowsKosong(opts: Parameters<typeof listPanes>[0]): number {
	return listPanes(opts).filter((p) => ["agy", "codex"].includes(p.command))
		.length;
}

test("register menyimpan agent bila pane-nya ada", async (t) => {
	const { tmux, file, ledger } = await siapkan(t);
	t.after(() => ledger.close());
	const agent = register(
		file,
		{ name: "agy", kind: "agy", tmux: "1:0.0", capabilities: ["playwright"] },
		tmux.opts,
	);
	assert.equal(agent.name, "agy");
	assert.deepEqual(readAgents(file), [agent]);
});

test("register menolak target yang tidak ada di tmux", async (t) => {
	const { tmux, file, ledger } = await siapkan(t);
	t.after(() => ledger.close());
	assert.throws(
		() =>
			register(
				file,
				{ name: "x", kind: "codex", tmux: "9:0.0", capabilities: [] },
				tmux.opts,
			),
		/9:0\.0.*tidak ada/,
	);
	assert.deepEqual(readAgents(file), []);
});

test("ls: siap, sibuk dengan tugas aktif, dan hilang bila sesi mati", async (t) => {
	const { tmux, file, ledger } = await siapkan(t);
	t.after(() => ledger.close());
	register(
		file,
		{ name: "agy", kind: "agy", tmux: "1:0.0", capabilities: ["playwright"] },
		tmux.opts,
	);
	register(
		file,
		{ name: "codex", kind: "codex", tmux: "2:0.0", capabilities: [] },
		tmux.opts,
	);

	let rows = agentRows(file, ledger, tmux.opts);
	assert.deepEqual(
		rows.map((r) => [r.name, r.status, r.tugas]),
		[
			["agy", "siap", undefined],
			["codex", "siap", undefined],
		],
	);

	const id = ledger.createTask({
		repo: "/r",
		agent: "agy",
		mode: "baca",
		brief: "b",
	});
	ledger.setStatus(id, "berjalan");
	tmux.killSession("2");
	rows = agentRows(file, ledger, tmux.opts);
	assert.deepEqual(
		rows.map((r) => [r.name, r.status, r.tugas]),
		[
			["agy", "sibuk", id],
			["codex", "hilang", undefined],
		],
	);
});

test("tugas antri atau selesai tidak membuat agent sibuk", async (t) => {
	const { tmux, file, ledger } = await siapkan(t);
	t.after(() => ledger.close());
	register(
		file,
		{ name: "agy", kind: "agy", tmux: "1:0.0", capabilities: [] },
		tmux.opts,
	);
	const a = ledger.createTask({
		repo: "/r",
		agent: "agy",
		mode: "baca",
		brief: "b",
	});
	const b = ledger.createTask({
		repo: "/r",
		agent: "agy",
		mode: "baca",
		brief: "b",
	});
	ledger.setStatus(b, "selesai");
	assert.equal(agentRows(file, ledger, tmux.opts)[0]?.status, "siap");
	ledger.setStatus(a, "berjalan");
	assert.equal(agentRows(file, ledger, tmux.opts)[0]?.status, "sibuk");
});

test("requireAvailable menolak agent hilang dan yang tidak terdaftar", async (t) => {
	const { tmux, file, ledger } = await siapkan(t);
	t.after(() => ledger.close());
	register(
		file,
		{ name: "codex", kind: "codex", tmux: "2:0.0", capabilities: [] },
		tmux.opts,
	);
	tmux.killSession("2");
	const rows = agentRows(file, ledger, tmux.opts);
	assert.throws(() => requireAvailable(rows, "codex"), /hilang/);
	assert.throws(() => requireAvailable(rows, "tidak-ada"), /tidak terdaftar/);
});

test("requireAvailable meneruskan agent yang ada", async (t) => {
	const { tmux, file, ledger } = await siapkan(t);
	t.after(() => ledger.close());
	register(
		file,
		{ name: "agy", kind: "agy", tmux: "1:0.0", capabilities: [] },
		tmux.opts,
	);
	const rows = agentRows(file, ledger, tmux.opts);
	assert.equal(requireAvailable(rows, "agy").name, "agy");
});

test("formatAgentRow: satu baris berisi nama, status, kemampuan, dan tugas", () => {
	assert.equal(
		formatAgentRow({
			name: "agy",
			kind: "agy",
			tmux: "1:0.0",
			capabilities: ["playwright", "brave"],
			status: "sibuk",
			tugas: 12,
		}),
		"agy       sibuk  playwright,brave  T12",
	);
	assert.equal(
		formatAgentRow({
			name: "codex",
			kind: "codex",
			tmux: "2:0.0",
			capabilities: [],
			status: "hilang",
			tugas: undefined,
		}),
		"codex     hilang  -",
	);
});

test("formatAgentRow: tidak-andal, ack, dan catatan ikut ditampilkan", () => {
	assert.equal(
		formatAgentRow({
			name: "opencode",
			kind: "opencode",
			tmux: "3:0.0",
			capabilities: [],
			status: "siap",
			tugas: undefined,
			tidakAndal: true,
			catatan: "teks tertahan",
		}),
		"opencode  tidak-andal  -  — teks tertahan",
	);
	assert.equal(
		formatAgentRow({
			name: "agy",
			kind: "agy",
			tmux: "1:0.0",
			capabilities: ["playwright"],
			status: "siap",
			tugas: undefined,
			ukur: { ackMs: 1840 },
		}),
		"agy       siap  playwright  ack 1.8s",
	);
});
