import assert from "node:assert/strict";
import { test } from "node:test";
import { checkNodeVersion } from "../src/runtime.js";

test("menerima versi Node yang sama dengan minimum", () => {
	assert.deepEqual(checkNodeVersion("22.13.0"), { ok: true });
});

test("menerima versi Node yang lebih tinggi", () => {
	for (const v of ["22.99.0", "23.0.0", "26.10.0"]) {
		assert.deepEqual(checkNodeVersion(v), { ok: true }, v);
	}
});

test("menolak versi yang lebih rendah dan menyebut minimum serta versi terpasang", () => {
	for (const v of ["22.12.9", "20.19.0", "18.0.0"]) {
		const result = checkNodeVersion(v);
		assert.equal(result.ok, false, v);
		if (result.ok) return;
		assert.match(result.message, /22\.13/);
		assert.ok(result.message.includes(v), result.message);
	}
});

test("menolak string versi yang tidak dapat dibaca", () => {
	assert.equal(checkNodeVersion("bukan-versi").ok, false);
});

test("minimum dapat diganti", () => {
	assert.deepEqual(checkNodeVersion("24.0.0", "24.0.0"), { ok: true });
	assert.equal(checkNodeVersion("23.9.9", "24.0.0").ok, false);
});
