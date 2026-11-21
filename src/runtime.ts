/** Versi Node minimum: `node:sqlite` bawaan tersedia tanpa flag mulai 22.13. */
export const MIN_NODE = "22.13.0";

export type NodeCheck = { ok: true } | { ok: false; message: string };

function parse(version: string): [number, number, number] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Memeriksa versi Node terhadap minimum. Harus dipanggil sebelum modul yang
 * memakai `node:sqlite` dimuat, supaya pengguna mendapat pesan jelas, bukan galat impor.
 */
export function checkNodeVersion(
	current: string,
	min: string = MIN_NODE,
): NodeCheck {
	const have = parse(current);
	const need = parse(min);
	if (have && need) {
		const [hMajor, hMinor, hPatch] = have;
		const [nMajor, nMinor, nPatch] = need;
		const ok =
			hMajor !== nMajor
				? hMajor > nMajor
				: hMinor !== nMinor
					? hMinor > nMinor
					: hPatch >= nPatch;
		if (ok) return { ok: true };
	}
	return {
		ok: false,
		message: `rempug membutuhkan Node ${min} atau lebih baru; yang terpasang: ${current}.`,
	};
}
