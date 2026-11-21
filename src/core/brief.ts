import { parseSections } from "./sections.js";

export const SECTIONS = [
	"TUJUAN",
	"CAKUPAN",
	"LANGKAH",
	"CEK",
	"BALASAN",
] as const;
type Section = (typeof SECTIONS)[number];

export type Cakupan =
	| { mode: "edit"; paths: string[] }
	| { mode: "baca" }
	| { mode: "browser" };

export interface Brief {
	tujuan: string;
	cakupan: Cakupan;
	langkah: string[];
	cek: string[];
	balasan: string;
}

export type BriefResult =
	| { ok: true; brief: Brief }
	| { ok: false; errors: string[] };

const LANGKAH_BARIS = /^\s*\d+[.)]\s+(.*)$/;

function parsePath(raw: string): string | undefined {
	const path = raw.replace(/^(\.\/)+/, "");
	if (!path || path.startsWith("/") || path.startsWith("-")) return undefined;
	return path.split("/").includes("..") ? undefined : path;
}

function parseCakupan(text: string, errors: string[]): Cakupan | undefined {
	const [mode, ...rest] = text.split(/[\s,]+/).filter(Boolean);
	if ((mode === "baca" || mode === "browser") && rest.length === 0)
		return { mode };
	if (mode === "edit") {
		if (rest.length === 0) {
			errors.push("CAKUPAN: mode edit wajib menyebut minimal satu path");
			return undefined;
		}
		const paths = rest.map(parsePath);
		const buruk = rest.filter((_, i) => paths[i] === undefined);
		if (buruk.length > 0) {
			errors.push(
				`CAKUPAN: path tidak valid (harus relatif terhadap repo, tanpa "..", tidak diawali "-"): ${buruk.join(", ")}`,
			);
			return undefined;
		}
		return { mode, paths: paths as string[] };
	}
	errors.push('CAKUPAN harus "edit <path...>", "baca", atau "browser"');
	return undefined;
}

function parseLangkah(text: string, errors: string[]): string[] {
	const langkah: string[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		const nomor = LANGKAH_BARIS.exec(line);
		if (nomor) langkah.push((nomor[1] ?? "").trim());
		else if (langkah.length > 0)
			langkah[langkah.length - 1] += ` ${line.trim()}`;
		else {
			errors.push('LANGKAH harus bernomor, mis. "1. buka halaman"');
			return [];
		}
	}
	return langkah;
}

/** Mengurai dan memvalidasi brief; semua kekurangan dilaporkan sekaligus. */
export function parseBrief(text: string): BriefResult {
	const { body: found, errors } = parseSections(text, SECTIONS);
	const body = new Map<Section, string>();
	for (const section of SECTIONS) {
		const content = found.get(section);
		if (content) body.set(section, content);
		else errors.push(`bagian ${section} hilang atau kosong`);
	}

	const cakupan = body.has("CAKUPAN")
		? parseCakupan(body.get("CAKUPAN") as string, errors)
		: undefined;
	const langkah = body.has("LANGKAH")
		? parseLangkah(body.get("LANGKAH") as string, errors)
		: [];
	const cekText = body.get("CEK");
	const cek =
		cekText === undefined || /^(-|tidak ada)$/i.test(cekText)
			? []
			: cekText
					.split("\n")
					.map((l) => l.trim())
					.filter(Boolean);
	if (cekText !== undefined && cakupan?.mode === "edit" && cek.length === 0)
		errors.push("CEK wajib berisi minimal satu perintah untuk tugas edit");

	if (errors.length > 0 || !cakupan) return { ok: false, errors };
	return {
		ok: true,
		brief: {
			tujuan: body.get("TUJUAN") as string,
			cakupan,
			langkah,
			cek,
			balasan: body.get("BALASAN") as string,
		},
	};
}
