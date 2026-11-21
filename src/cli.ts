#!/usr/bin/env node
import { checkNodeVersion } from "./runtime.js";

const node = checkNodeVersion(process.versions.node);
if (!node.ok) {
	console.error(node.message);
	process.exit(1);
}

// `node:sqlite` masih eksperimental di Node 22 dan mencetak peringatan ke stderr, yang akan
// mengotori keluaran yang dibaca agent. Hanya peringatan itu yang dibuang.
const emitAsli = process.emitWarning;
process.emitWarning = ((peringatan: string | Error, ...sisa: unknown[]) => {
	const tipe =
		typeof sisa[0] === "string"
			? sisa[0]
			: (sisa[0] as { type?: string } | undefined)?.type;
	if (tipe === "ExperimentalWarning" && String(peringatan).includes("SQLite"))
		return;
	return (emitAsli as (...a: unknown[]) => void).call(
		process,
		peringatan,
		...sisa,
	);
}) as typeof process.emitWarning;

const { run } = await import("./commands.js");

async function bacaStdin(): Promise<string> {
	if (process.stdin.isTTY)
		throw new (await import("./core/errors.js")).UsageError(
			"isi dibaca dari stdin; pipe teks ke perintah ini (mis. rempug reply T1 <<'EOF' ... EOF)",
		);
	const potongan: Buffer[] = [];
	for await (const p of process.stdin) potongan.push(p as Buffer);
	return Buffer.concat(potongan).toString("utf8");
}

const kontrol = new AbortController();
for (const sinyal of ["SIGINT", "SIGTERM"] as const)
	process.on(sinyal, () => kontrol.abort());

process.exitCode = await run(process.argv.slice(2), {
	env: process.env,
	cwd: process.cwd(),
	tmux: process.env.REMPUG_TMUX_SOCKET
		? { socket: process.env.REMPUG_TMUX_SOCKET }
		: undefined,
	sinyal: kontrol.signal,
	io: {
		stdout: (teks) => void process.stdout.write(`${teks}\n`),
		stderr: (teks) => void process.stderr.write(`${teks}\n`),
		stdin: bacaStdin,
	},
});
