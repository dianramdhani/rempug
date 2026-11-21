#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { checkNodeVersion } from "./runtime.js";

const node = checkNodeVersion(process.versions.node);
if (!node.ok) {
	console.error(node.message);
	process.exit(1);
}

const [command] = process.argv.slice(2);

if (command === "--version") {
	const { version } = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	) as { version: string };
	console.log(version);
} else {
	console.error(`rempug: perintah "${command ?? ""}" belum tersedia.`);
	process.exitCode = 2;
}
