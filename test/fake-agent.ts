/**
 * Agent palsu untuk uji: meniru TUI berkotak di pane tmux (riwayat, garis batas, prompt).
 * Pakai: node fake-agent.js <mode> <berkas-keluaran>
 *  - normal : menerima ketikan biasa; Enter mengirim.
 *  - paste  : membuang ketikan biasa; hanya teks bracketed-paste yang masuk kotak input.
 *  - menu   : kotak input berisi sisa "x" (butuh Ctrl-U) dan Enter pertama ditelan.
 * Perilaku tambahan lewat env:
 *  - FAKE_ACK=1      : membaca brief (rempug brief) begitu menerima pointer, seperti agent sungguhan.
 *  - FAKE_TUNDA_MS=n : sebelum ack, "bekerja" selama n ms dengan teks kemajuan yang terus berubah (seperti model sungguhan).
 *  - FAKE_TUNDA_TANPA_ACK=1 : bekerja selama FAKE_TUNDA_MS lalu diam tanpa pernah ack.
 *  - FAKE_GALAT_JAUH=1 : menampilkan "Token refresh failed: 401" lalu 14 baris sidebar, seperti tata letak opencode.
 *  - FAKE_SIBUK=1    : selalu menampilkan penanda sibuk statis "esc to interrupt" (layar diam walau agent sedang bekerja).
 *  - FAKE_NOENTER=1  : mengabaikan Enter, jadi teks tertahan di kotak input.
 *  - FAKE_LAMBAT_MS=n : memproses Enter n ms setelah diterima (meniru runner CI yang lambat).
 *  - FAKE_SPIN=1     : layar terus berubah (spinner) walau idle.
 *  - FAKE_AFTER=ask|izin|limit : tampilkan pertanyaan, prompt izin, atau pesan limit setelah menerima baris.
 *  - FAKE_CLI=<cli.js> + FAKE_PERILAKU: menjalankan protokol rempug sungguhan lewat proses CLI:
 *      patuh (bawaan), menyimpang (rencana menyentuh package.json), tanpa-paham, curang (mengaku beres tanpa
 *      mengubah apa pun), commit (git commit diam-diam), ack-lalu-tanya (membaca brief lalu bertanya).
 *    FAKE_EDIT=<berkas> adalah berkas yang diubah agent.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { parseBrief } from "../src/core/brief.js";

const [mode = "normal", out = ""] = process.argv.slice(2);
let buffer = mode === "menu" ? "x" : "";
let menuOpen = mode === "menu";
let inPaste = false;
let transcript = "";
let frame = 0;

const GALAT_JAUH = process.env.FAKE_GALAT_JAUH
	? `Token refresh failed: 401\n${Array.from({ length: 14 }, (_, i) => `  sidebar baris ${i + 1}`).join("\n")}\n`
	: "";

function render(): void {
	const spin = process.env.FAKE_SPIN ? ` ${"|/-\\"[frame++ % 4]}` : "";
	process.stdout.write(
		`\x1b[2J\x1b[Hfake-agent ${mode}${spin}\n${GALAT_JAUH}${transcript}\n+------------+\n> ${buffer}${process.env.FAKE_SIBUK ? "\n• Working (12s • esc to interrupt)" : ""}`,
	);
}

async function ack(id: number): Promise<void> {
	const { Ledger, ledgerPath } = await import("../src/core/ledger.js");
	const { readBrief } = await import("../src/core/send.js");
	const ledger = Ledger.open(ledgerPath());
	try {
		readBrief(ledger, id);
	} finally {
		ledger.close();
	}
}

/** Menjalankan protokol rempug seperti agent sungguhan, lewat proses CLI nyata. */
async function protokol(id: number): Promise<void> {
	const cli = (args: string[], input?: string) =>
		execFileSync(process.execPath, [process.env.FAKE_CLI as string, ...args], {
			input,
			encoding: "utf8",
			env: process.env,
		});
	const perilaku = process.env.FAKE_PERILAKU;
	const baris = cli(["brief", `T${id}`]).split("\n");
	const parsed = parseBrief(
		baris.slice(3, baris.indexOf("PROTOKOL:")).join("\n"),
	);
	if (!parsed.ok) return;
	const { cakupan, cek } = parsed.brief;
	if (perilaku === "ack-lalu-tanya") {
		transcript += "Which option do you prefer, A or B?\n";
		return;
	}
	const berkas = process.env.FAKE_EDIT;
	if (cakupan.mode === "edit" && perilaku !== "tanpa-paham") {
		const rencana =
			perilaku === "menyimpang"
				? `1. Ubah ${berkas} dan package.json`
				: `1. Ubah ${berkas}`;
		let hasil = cli(
			["paham", `T${id}`],
			[
				`CAKUPAN: edit ${cakupan.paths.join(", ")}`,
				`CEK:\n${cek.join("\n")}`,
				`RENCANA: ${rencana}`,
				"ASUMSI: -",
				"PERTANYAAN: -",
			].join("\n"),
		);
		while (hasil.startsWith("MENUNGGU")) {
			do hasil = cli(["tunggu", `T${id}`]);
			while (hasil.startsWith("BELUM"));
			if (/^(STOP|GAGAL)/.test(hasil)) return;
		}
	}
	if (berkas && perilaku !== "curang")
		appendFileSync(berkas, `// diubah agent T${id}\n`);
	if (perilaku === "commit")
		execFileSync("git", ["commit", "-aqm", "diam-diam"]);
	cli(["reply", `T${id}`], "HASIL: selesai\nBUKTI: ok");
}

/** Meniru model yang sedang bekerja: teks kemajuan berubah (huruf, bukan angka) selama `ms`. */
async function bekerja(ms: number): Promise<void> {
	const kata = [
		"membaca",
		"menimbang",
		"mencari",
		"memeriksa",
		"menyusun",
		"menulis",
		"menguji",
		"merapikan",
	];
	for (let t = 0, i = 0; t < ms; t += 250, i++) {
		transcript += `* ${kata[i % kata.length]} ${"x".repeat(1 + (i % 5))}\n`;
		render();
		await new Promise((r) => setTimeout(r, 250));
	}
}

async function accept(line: string): Promise<void> {
	if (out) appendFileSync(out, `${line}\n`);
	transcript += `you: ${line}\n`;
	const brief = /rempug brief T(\d+)/.exec(line);
	if (brief && process.env.FAKE_TUNDA_MS)
		await bekerja(Number(process.env.FAKE_TUNDA_MS));
	if (process.env.FAKE_ACK && brief && !process.env.FAKE_TUNDA_TANPA_ACK)
		await ack(Number(brief[1]));
	if (process.env.FAKE_CLI && brief) await protokol(Number(brief[1]));
	const after = process.env.FAKE_AFTER;
	if (after === "ask") transcript += "Which option do you prefer, A or B?\n";
	if (after === "izin") transcript += "Allow this command to run? (y/n)\n";
	if (after === "limit") transcript += "You have hit your usage limit.\n";
	render();
}

function submit(): void {
	if (process.env.FAKE_NOENTER) return;
	const lambat = Number(process.env.FAKE_LAMBAT_MS ?? 0);
	if (lambat > 0) setTimeout(proses, lambat);
	else proses();
}

function proses(): void {
	if (menuOpen) {
		menuOpen = false;
		return;
	}
	if (!buffer) return;
	const line = buffer;
	buffer = "";
	void accept(line);
}

process.stdout.write("\x1b[?2004h");
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
render();
if (process.env.FAKE_SPIN) setInterval(render, 150);

process.stdin.on("data", (data: string) => {
	for (let i = 0; i < data.length; i++) {
		if (data.startsWith("\x1b[200~", i)) {
			inPaste = true;
			i += 5;
		} else if (data.startsWith("\x1b[201~", i)) {
			inPaste = false;
			i += 5;
		} else {
			const ch = data[i] as string;
			if (inPaste) {
				if (ch !== "\r" && ch !== "\n") buffer += ch;
			} else if (ch === "\r") submit();
			else if (ch === "\x15") buffer = "";
			else if (ch >= " " && mode !== "paste") buffer += ch;
		}
	}
	render();
});
