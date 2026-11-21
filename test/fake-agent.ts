/**
 * Agent palsu untuk uji: meniru TUI yang berbeda-beda di pane tmux.
 * Pakai: node fake-agent.js <mode> <berkas-keluaran>
 *  - normal : menerima ketikan biasa; Enter mengirim.
 *  - paste  : membuang ketikan biasa; hanya teks bracketed-paste yang masuk kotak input.
 *  - menu   : kotak input berisi sisa "x" (butuh Ctrl-U) dan Enter pertama ditelan.
 * Setiap baris yang diterima ditambahkan ke berkas keluaran.
 */
import { appendFileSync } from "node:fs";

const [mode = "normal", out = ""] = process.argv.slice(2);
let buffer = mode === "menu" ? "x" : "";
let menuOpen = mode === "menu";
let inPaste = false;

function render(): void {
	process.stdout.write(`\x1b[2J\x1b[Hfake-agent ${mode}\n> ${buffer}`);
}

function submit(): void {
	if (menuOpen) {
		menuOpen = false;
		return;
	}
	if (!buffer) return;
	if (out) appendFileSync(out, `${buffer}\n`);
	buffer = "";
}

process.stdout.write("\x1b[?2004h");
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
render();

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
