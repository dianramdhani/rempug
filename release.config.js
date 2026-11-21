/** Rilis otomatis: Conventional Commits -> versi semver, CHANGELOG, GitHub Release, dan publish npm. */
export default {
	branches: ["main"],
	plugins: [
		[
			"@semantic-release/commit-analyzer",
			{
				preset: "angular",
				releaseRules: [{ type: "refactor", release: "patch" }],
			},
		],
		["@semantic-release/release-notes-generator", { preset: "angular" }],
		["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
		"@semantic-release/npm",
		"@semantic-release/github",
		[
			"@semantic-release/git",
			{
				assets: ["CHANGELOG.md", "package.json", "package-lock.json"],
				message:
					// Placeholder ini diganti oleh semantic-release sendiri, bukan oleh JavaScript.
					// biome-ignore lint/suspicious/noTemplateCurlyInString: template semantic-release
					"chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
			},
		],
	],
};
