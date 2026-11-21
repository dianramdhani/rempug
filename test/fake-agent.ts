/**
 * Agent palsu untuk uji: meniru TUI berkotak di pane tmux (riwayat, garis batas, prompt).
 * Pakai: node fake-agent.js <mode> <berkas-keluaran>
 *  - normal : menerima ketikan biasa; Enter mengirim.
 *  - paste  : membuang ketikan biasa; hanya teks bracketed-paste yang masuk kotak input.
 *  - menu   : kotak input berisi sisa "x" (butuh Ctrl-U) dan Enter pertama ditelan.
 * Perilaku tambahan lewat env:
 *  - FAKE_ACK=1      : membaca brief (rempug brief) begitu menerima pointer, seperti agent sungguhan.
 *  - FAKE_NOENTER=1  : mengabaikan Enter, jadi teks tertahan di kotak input.
 *  - FAKE_SPIN=1     : layar terus berubah (spinner) walau idle.
 *  - FAKE_AFTER=ask|izin|limit : tampilkan pertanyaan, prompt izin, atau pesan limit setelah menerima baris.
 */
import { appendFileSync } from "node:fs";

const [mode = "normal", out = ""] = process.argv.slice(2);
let buffer = mode === "menu" ? "x" : "";
let menuOpen = mode === "menu";
let inPaste = false;
let transcript = "";
let frame = 0;

function render(): void {
	const spin = process.env.FAKE_SPIN ? ` ${"|/-\\"[frame++ % 4]}` : "";
	process.stdout.write(
		`\x1b[2J\x1b[Hfake-agent ${mode}${spin}\n${transcript}\n+------------+\n> ${buffer}`,
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

async function accept(line: string): Promise<void> {
	if (out) appendFileSync(out, `${line}\n`);
	transcript += `you: ${line}\n`;
	const brief = /rempug brief T(\d+)/.exec(line);
	if (process.env.FAKE_ACK && brief) await ack(Number(brief[1]));
	const after = process.env.FAKE_AFTER;
	if (after === "ask") transcript += "Which option do you prefer, A or B?\n";
	if (after === "izin") transcript += "Allow this command to run? (y/n)\n";
	if (after === "limit") transcript += "You have hit your usage limit.\n";
	render();
}

function submit(): void {
	if (process.env.FAKE_NOENTER) return;
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
