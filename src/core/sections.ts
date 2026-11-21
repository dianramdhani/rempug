export interface Sections {
	/** Isi tiap bagian (kosong bila hanya labelnya yang ada). */
	body: Map<string, string>;
	errors: string[];
}

/** Memecah teks berlabel `NAMA: isi` menjadi bagian; isi berlanjut sampai label berikutnya. */
export function parseSections(
	text: string,
	labels: readonly string[],
): Sections {
	const label = new RegExp(`^(${labels.join("|")}):[ \\t]*(.*)$`);
	const found = new Map<string, string[]>();
	const errors: string[] = [];
	let current: string | undefined;
	for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
		const match = label.exec(line);
		if (match) {
			current = match[1] as string;
			if (found.has(current)) errors.push(`bagian ${current} muncul dua kali`);
			else found.set(current, [match[2] ?? ""]);
		} else if (current) found.get(current)?.push(line);
		else if (line.trim())
			errors.push(`ada teks sebelum label pertama: "${line.trim()}"`);
	}
	return {
		body: new Map([...found].map(([k, lines]) => [k, lines.join("\n").trim()])),
		errors,
	};
}
