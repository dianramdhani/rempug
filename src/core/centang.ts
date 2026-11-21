import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { RempugError, UsageError } from "./errors.js";

const escapeRegex = (teks: string) =>
	teks.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Mencentang satu item `tasks.md` (`berkas#nomor`, mis. `spec/tasks.md#2.1`): hanya baris itu yang berubah
 * dari `- [ ]` menjadi `- [x]`. Mengembalikan `false` bila item sudah tercentang.
 */
export function centangItem(spesifikasi: string, repo: string): boolean {
	const [berkas, nomor, ...lebih] = spesifikasi.split("#");
	if (!berkas || !nomor || lebih.length > 0)
		throw new UsageError(
			`--centang harus berbentuk berkas#nomor, mis. spec/tasks.md#2.1 (diterima: ${spesifikasi})`,
		);
	const path = resolve(repo, berkas);
	const rel = relative(repo, path);
	if (isAbsolute(berkas) || rel.startsWith("..") || isAbsolute(rel))
		throw new UsageError(
			`${berkas} di luar repo; --centang hanya untuk berkas di dalam repo`,
		);

	let isi: string;
	try {
		isi = readFileSync(path, "utf8");
	} catch {
		throw new RempugError(`berkas ${berkas} tidak ada`);
	}
	// Nomor tingkat atas ditulis "2." sedangkan sub-item "2.1"; "2" tidak boleh cocok dengan "2.1".
	const belum = new RegExp(
		`^(\\s*- )\\[ \\] (${escapeRegex(nomor)}(?:\\.(?=\\s)|(?=\\s)))`,
		"m",
	);
	const sudah = new RegExp(
		`^\\s*- \\[x\\] ${escapeRegex(nomor)}(?:\\.(?=\\s)|(?=\\s))`,
		"m",
	);
	if (!belum.test(isi)) {
		if (sudah.test(isi)) return false;
		throw new RempugError(`item ${nomor} tidak ditemukan di ${berkas}`);
	}
	writeFileSync(path, isi.replace(belum, "$1[x] $2"));
	return true;
}
