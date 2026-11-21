import assert from "node:assert/strict";
import { test } from "node:test";
import { scan, scorePanes } from "../../src/core/scan.js";
import type { Pane } from "../../src/core/tmux.js";
import { startTmux, tmp, until } from "../helpers.js";

const REPO = "/work/app";

const pane = (over: Partial<Pane>): Pane => ({
	session: "1",
	window: 0,
	pane: 0,
	paneId: "%1",
	command: "bash",
	path: "/lain",
	target: "1:0.0",
	...over,
});

test("perintah agent dikenal berskor tinggi dan jenisnya terbaca", () => {
	const [c] = scorePanes([pane({ command: "codex" })], REPO);
	assert.equal(c?.skor, 3);
	assert.equal(c?.keyakinan, "tinggi");
	assert.equal(c?.jenis, "codex");
});

test("direktori sama dengan repo menambah 2, di dalam repo menambah 1", () => {
	const skor = (path: string, command = "codex") =>
		scorePanes([pane({ command, path })], REPO)[0]?.skor;
	assert.equal(skor(REPO), 5);
	assert.equal(skor(`${REPO}/src`), 4);
	assert.equal(skor("/work/app-lain"), 3);
	assert.equal(skor(REPO, "sleep"), 2);
	assert.equal(skor(`${REPO}/src`, "sleep"), 1);
	assert.equal(skor("/lain", "sleep"), 0);
});

test("perintah tak dikenal di dalam repo berkeyakinan sedang, jenis tidak diketahui", () => {
	const [c] = scorePanes([pane({ command: "node", path: REPO })], REPO);
	assert.equal(c?.keyakinan, "sedang");
	assert.equal(c?.jenis, "tidak-diketahui");
});

test("node di luar repo berkeyakinan rendah", () => {
	const [c] = scorePanes([pane({ command: "node" })], REPO);
	assert.equal(c?.keyakinan, "rendah");
});

test("mengecualikan editor dan shell", () => {
	const panes = [
		"nvim",
		"vim",
		"bash",
		"zsh",
		"sh",
		"fish",
		"less",
		"htop",
	].map((command, i) =>
		pane({ command, path: REPO, paneId: `%${i}`, pane: i }),
	);
	assert.deepEqual(scorePanes(panes, REPO), []);
});

test("mengecualikan pane orkestrator sendiri", () => {
	const panes = [
		pane({ command: "claude", paneId: "%9", target: "0:0.1" }),
		pane({ command: "codex", paneId: "%2", target: "2:0.0" }),
	];
	assert.deepEqual(
		scorePanes(panes, REPO, "%9").map((c) => c.target),
		["2:0.0"],
	);
});

test("urut menurun menurut skor, lalu target", () => {
	const panes = [
		pane({ command: "sleep", path: "/lain", target: "5:0.0", paneId: "%5" }),
		pane({ command: "codex", path: "/lain", target: "3:0.0", paneId: "%3" }),
		pane({ command: "agy", path: REPO, target: "4:0.0", paneId: "%4" }),
		pane({ command: "codex", path: "/lain", target: "2:0.0", paneId: "%2" }),
	];
	assert.deepEqual(
		scorePanes(panes, REPO).map((c) => c.target),
		["4:0.0", "2:0.0", "3:0.0", "5:0.0"],
	);
});

test("scan membaca pane tmux sungguhan dan mengecualikan non-agent", async (t) => {
	const repo = tmp(t);
	const tmux = startTmux(t);
	tmux.newSession("1", repo, "agy");
	tmux.newSession("2", repo, "codex");
	tmux.newSession("3", repo, "nvim");
	tmux.newSession("4", tmp(t), "sleep");

	const hasil = await until(() => {
		const r = scan(repo, { tmux: tmux.opts });
		const jenis = r.kandidat.map((c) => c.jenis);
		return jenis.includes("agy") && jenis.includes("codex") ? r : undefined;
	});

	assert.equal(hasil.repo, repo);
	const tinggi = hasil.kandidat.filter((c) => c.keyakinan === "tinggi");
	assert.deepEqual(tinggi.map((c) => [c.target, c.jenis]).sort(), [
		["1:0.0", "agy"],
		["2:0.0", "codex"],
	]);
	assert.equal(
		hasil.kandidat.some((c) => c.perintah === "nvim"),
		false,
	);
});

test("scan tanpa server tmux mengembalikan daftar kosong", (t) => {
	const hasil = scan("/r", { tmux: { socket: `tidak-ada-${process.pid}` } });
	assert.deepEqual(hasil.kandidat, []);
	void t;
});
