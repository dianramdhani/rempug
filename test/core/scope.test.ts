import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Ledger } from "../../src/core/ledger.js";
import {
	claimConflicts,
	formatConflict,
	scopesOverlap,
} from "../../src/core/scope.js";
import { tmp } from "../helpers.js";

const overlap = (a: string, b: string) => scopesOverlap([a], [b]);

test("path yang sama bertabrakan", () => {
	assert.equal(overlap("src/a.ts", "src/a.ts"), true);
	assert.equal(overlap("src/a", "./src/a/"), true);
});

test("induk dan anak bertabrakan di kedua arah", () => {
	assert.equal(overlap("src/features", "src/features/device/index.tsx"), true);
	assert.equal(overlap("src/features/device/index.tsx", "src/features"), true);
});

test("saudara dengan awalan nama mirip tidak bertabrakan", () => {
	assert.equal(overlap("src/a", "src/ab"), false);
	assert.equal(overlap("src/a/**", "src/b/**"), false);
	assert.equal(overlap("src/a.ts", "src/b.ts"), false);
});

test("glob yang beririsan bertabrakan", () => {
	assert.equal(overlap("src/features/**", "src/features/device/**"), true);
	assert.equal(overlap("src/**/*.ts", "src/features/a.ts"), true);
	assert.equal(overlap("src/*.ts", "src/a.ts"), true);
	assert.equal(overlap("**", "src/anything/at/all.ts"), true);
	assert.equal(overlap(".", "src/a.ts"), true);
});

test("glob yang tidak beririsan tidak bertabrakan", () => {
	assert.equal(overlap("src/*.ts", "src/foo/bar.ts"), false);
	assert.equal(overlap("src/**/*.test.ts", "lib/a.test.ts"), false);
	assert.equal(overlap("docs/**", "src/**"), false);
});

test("dua glob yang sama-sama punya wildcard dianggap bertabrakan (konservatif)", () => {
	assert.equal(overlap("src/*.ts", "src/a*.tsx"), true);
});

test("daftar: bertabrakan bila ada satu pasangan yang beririsan", () => {
	assert.equal(
		scopesOverlap(["src/a/**", "src/b.ts"], ["lib/x", "src/b.ts"]),
		true,
	);
	assert.equal(scopesOverlap(["src/a/**"], ["lib/x", "docs"]), false);
	assert.equal(scopesOverlap([], ["src"]), false);
});

function siapkan(t: Parameters<typeof tmp>[0]) {
	const ledger = Ledger.open(join(tmp(t), "l.db"));
	t.after(() => ledger.close());
	const mulai = (
		agent: string,
		mode: "edit" | "baca" | "browser",
		scope?: string[],
	) => {
		const id = ledger.createTask({
			repo: "/r",
			agent,
			mode,
			scope,
			brief: "b",
		});
		ledger.setStatus(id, "berjalan");
		return id;
	};
	return { ledger, mulai };
}

test("tugas edit baru bentrok dengan tugas edit aktif yang beririsan", (t) => {
	const { ledger, mulai } = siapkan(t);
	const aktif = mulai("codex", "edit", ["src/features/device/**"]);
	const konflik = claimConflicts(ledger, "/r", {
		mode: "edit",
		scope: ["src/features/device/index.tsx", "src/lib/**"],
	});
	assert.deepEqual(konflik, [
		{
			taskId: aktif,
			agent: "codex",
			pola: "src/features/device/index.tsx",
			denganPola: "src/features/device/**",
		},
	]);
});

test("tugas edit yang tidak beririsan boleh berjalan paralel", (t) => {
	const { ledger, mulai } = siapkan(t);
	mulai("codex", "edit", ["src/features/device/**"]);
	assert.deepEqual(
		claimConflicts(ledger, "/r", {
			mode: "edit",
			scope: ["src/features/sim/**"],
		}),
		[],
	);
});

test("tugas baca dan browser tidak pernah bentrok dan tidak memegang klaim", (t) => {
	const { ledger, mulai } = siapkan(t);
	mulai("agy", "baca");
	mulai("agy2", "browser");
	mulai("codex", "edit", ["src/**"]);
	assert.deepEqual(claimConflicts(ledger, "/r", { mode: "baca" }), []);
	assert.deepEqual(claimConflicts(ledger, "/r", { mode: "browser" }), []);
	assert.deepEqual(
		claimConflicts(ledger, "/r", { mode: "edit", scope: ["src/a.ts"] }).map(
			(c) => c.agent,
		),
		["codex"],
	);
});

test("klaim lepas saat tugas selesai atau gagal", (t) => {
	const { ledger, mulai } = siapkan(t);
	const id = mulai("codex", "edit", ["src/**"]);
	const baru = { mode: "edit" as const, scope: ["src/a.ts"] };
	assert.equal(claimConflicts(ledger, "/r", baru).length, 1);
	ledger.setStatus(id, "selesai");
	assert.deepEqual(claimConflicts(ledger, "/r", baru), []);
	ledger.setStatus(id, "berjalan");
	ledger.setStatus(id, "gagal");
	assert.deepEqual(claimConflicts(ledger, "/r", baru), []);
});

test("klaim tidak lintas repo", (t) => {
	const { ledger, mulai } = siapkan(t);
	mulai("codex", "edit", ["src/**"]);
	assert.deepEqual(
		claimConflicts(ledger, "/repo-lain", { mode: "edit", scope: ["src/a.ts"] }),
		[],
	);
});

test("formatConflict menyebut tugas, agent, dan kedua pola", () => {
	assert.equal(
		formatConflict({
			taskId: 12,
			agent: "codex",
			pola: "src/a.ts",
			denganPola: "src/**",
		}),
		"bentrok dengan T12 (codex): src/a.ts beririsan dengan src/**",
	);
});
