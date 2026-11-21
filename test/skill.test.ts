import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const baca = (rel: string) =>
	readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const skill = baca("skills/rempug/SKILL.md");

test("SKILL.md punya frontmatter name dan description", () => {
	const m = /^---\nname: rempug\ndescription: (.+)\n---\n/.exec(skill);
	assert.ok(m, "frontmatter tidak valid");
	assert.ok((m[1] ?? "").length > 40);
});

test("SKILL.md memuat aturan yang membuat mode otomatis aman", () => {
	for (const pola of [
		/Jangan pernah menjawab prompt izin/,
		/Monitor/,
		/timeout_ms/,
		/pasang ulang/i,
		/maks 2 kali/,
		/Jangan menarasikan/,
		/--centang/,
		/grill-me/,
		/rempug status/,
	])
		assert.match(skill, pola);
});

test("setiap perintah yang disebut skill benar-benar ada di CLI", () => {
	const usage = baca("dist/src/commands.js");
	const disebut = new Set(
		[
			...skill.matchAll(
				/`(?:rempug )?(scan|register|probe|ls|status|send|jawab|layar|show|diff|watch)\b/g,
			),
		].map((m) => m[1]),
	);
	assert.ok(disebut.size >= 8);
	for (const perintah of disebut)
		assert.match(usage, new RegExp(`\\b${perintah}\\b`), perintah);
});

test("manifest plugin, hook, dan konfigurasi MCP valid dan konsisten", () => {
	const plugin = JSON.parse(baca(".claude-plugin/plugin.json")) as Record<
		string,
		unknown
	>;
	assert.equal(plugin.name, "rempug");
	assert.equal(
		"version" in plugin,
		false,
		"versi dikelola semantic-release, bukan plugin.json",
	);

	const hooks = JSON.parse(baca("hooks/hooks.json")) as {
		hooks: { SessionStart: { hooks: { command: string }[] }[] };
	};
	assert.match(
		hooks.hooks.SessionStart[0]?.hooks[0]?.command ?? "",
		/rempug status/,
	);

	const mcp = JSON.parse(baca(".mcp.json")) as {
		mcpServers: { rempug: { command: string; args: string[] } };
	};
	assert.deepEqual(mcp.mcpServers.rempug.args, ["-y", "rempug", "mcp"]);
});

test("paket menyertakan skill dan plugin tetapi bukan uji maupun spec", () => {
	const pkg = JSON.parse(baca("package.json")) as { files: string[] };
	for (const f of ["skills", ".claude-plugin", "hooks", ".mcp.json"])
		assert.ok(pkg.files.includes(f), f);
	for (const f of pkg.files) assert.ok(!/test|\.kiro/.test(f), f);
});
