import type { Ledger, TaskMode } from "./ledger.js";

const WILDCARD = /[*?[]/;

/**
 * Memecah pola menjadi segmen. Path tanpa wildcard dianggap sebagai dirinya sendiri
 * beserta isinya (`src/a` ≡ `src/a/**`), karena tanpa melihat disk tidak diketahui
 * apakah ia berkas atau direktori. Akibatnya pengecekan konservatif: lebih baik
 * menolak tugas yang sebenarnya aman daripada membiarkan dua agent menimpa file yang sama.
 */
function segments(pattern: string): string[] {
	const clean = pattern
		.trim()
		.replace(/^(\.\/)+/, "")
		.replace(/\/+/g, "/")
		.replace(/\/$/, "");
	if (clean === "" || clean === ".") return ["**"];
	const parts = clean.split("/").filter((s) => s !== ".");
	return parts.some((s) => WILDCARD.test(s)) ? parts : [...parts, "**"];
}

function segmentsMatch(a: string, b: string): boolean {
	if (a === b) return true;
	const aWild = WILDCARD.test(a);
	const bWild = WILDCARD.test(b);
	if (!aWild && !bWild) return false;
	if (aWild && bWild) return true;
	const [glob, literal] = aWild ? [a, b] : [b, a];
	if (glob.includes("[")) return true;
	const regex = glob
		.replace(/[.+^${}()|\]\\]/g, "\\$&")
		.replace(/\*/g, "[^/]*")
		.replace(/\?/g, "[^/]");
	return new RegExp(`^${regex}$`).test(literal);
}

function overlap(a: string[], b: string[]): boolean {
	if (a.length === 0) return b.every((s) => s === "**");
	if (b.length === 0) return a.every((s) => s === "**");
	const [x, ...xs] = a as [string, ...string[]];
	const [y, ...ys] = b as [string, ...string[]];
	if (x === "**") return overlap(xs, b) || overlap(a, ys);
	if (y === "**") return overlap(a, ys) || overlap(xs, b);
	return segmentsMatch(x, y) && overlap(xs, ys);
}

/** Apakah ada satu pasang pola dari kedua daftar yang mungkin mencocokkan path yang sama. */
export function scopesOverlap(a: string[], b: string[]): boolean {
	return a.some((p) => b.some((q) => overlap(segments(p), segments(q))));
}

export interface Conflict {
	taskId: number;
	agent: string;
	pola: string;
	denganPola: string;
}

/**
 * Tugas `edit` aktif yang cakupannya beririsan dengan tugas baru. Tugas `baca`
 * dan `browser` tidak mengklaim cakupan, jadi tidak pernah bentrok.
 */
export function claimConflicts(
	ledger: Ledger,
	repo: string,
	task: { mode: TaskMode; scope?: string[] },
): Conflict[] {
	if (task.mode !== "edit" || !task.scope) return [];
	const conflicts: Conflict[] = [];
	for (const aktif of ledger.activeEditTasks(repo)) {
		for (const pola of task.scope) {
			const denganPola = aktif.scope?.find((q) => scopesOverlap([pola], [q]));
			if (denganPola !== undefined) {
				conflicts.push({
					taskId: aktif.id,
					agent: aktif.agent,
					pola,
					denganPola,
				});
				break;
			}
		}
	}
	return conflicts;
}

export function formatConflict(c: Conflict): string {
	return `bentrok dengan T${c.taskId} (${c.agent}): ${c.pola} beririsan dengan ${c.denganPola}`;
}

function matchLiteral(pattern: string[], literal: string[]): boolean {
	if (pattern.length === 0) return literal.length === 0;
	const [p, ...rest] = pattern as [string, ...string[]];
	if (p === "**")
		return (
			matchLiteral(rest, literal) ||
			(literal.length > 0 && matchLiteral(pattern, literal.slice(1)))
		);
	if (literal.length === 0) return false;
	return (
		segmentsMatch(p, literal[0] as string) &&
		matchLiteral(rest, literal.slice(1))
	);
}

/** Apakah `path` termasuk dalam salah satu pola cakupan (path tanpa wildcard mencakup isinya). */
export function covers(patterns: string[], path: string): boolean {
	const literal = path
		.trim()
		.replace(/^(\.\/)+/, "")
		.replace(/\/+/g, "/")
		.replace(/\/$/, "")
		.split("/")
		.filter((s) => s !== "" && s !== ".");
	return patterns.some((p) => matchLiteral(segments(p), literal));
}
