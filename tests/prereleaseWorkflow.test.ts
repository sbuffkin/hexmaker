/**
 * B3 (release plan): a tag like 2.0.0-rc.2 pushed from a release candidate
 * branch publishes a GitHub pre-release through the same Obsidian review gate;
 * master and the store are untouched. These read .github/workflows/release.yml
 * as text (the YAML itself is checked by actionlint / a parse in the commit that
 * made it).
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";

const yml = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const job = (name: string) => {
	const m = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|$)`).exec(yml);
	if (!m) throw new Error(`no job ${name}`);
	return m[1];
};

describe("B3: the pre-release path", () => {
	it("fires on master pushes and on pre-release-looking tags only", () => {
		const on = /\non:\n([\s\S]*?)\njobs:/.exec(yml)?.[1] ?? "";
		expect(on).toContain("- master");
		expect(on).toContain('"[0-9]+.[0-9]+.[0-9]+-*"');
		expect(on).not.toMatch(/pull_request|workflow_dispatch/);
	});

	it("the store release runs on master only; the pre-release on tags only", () => {
		expect(job("release")).toContain("if: github.ref == 'refs/heads/master'");
		expect(job("prerelease")).toContain("if: startsWith(github.ref, 'refs/tags/')");
		// The directory's own scan follows the store release, never a pre-release.
		expect(job("obsidian-review")).toContain("needs: release");
	});

	it("goes through the same gates as a master release, then publishes a pre-release of the release build", () => {
		const pre = job("prerelease");
		for (const gate of ["npm test", "npm run check:release", 'node dev/obsidian-review.mjs preview "$GITHUB_SHA"', "npx tsc -noEmit -skipLibCheck"]) expect(pre).toContain(gate);
		// Gates come before the build and the release.
		expect(pre.indexOf("obsidian-review.mjs")).toBeLessThan(pre.indexOf("build-rc.mjs"));
		expect(pre.indexOf("build-rc.mjs")).toBeLessThan(pre.indexOf("gh release create"));
		expect(pre).toContain('node dev/release/build-rc.mjs --out "$RUNNER_TEMP/rc" --version "$TAG"');
		expect(pre).toMatch(/gh release create "\$TAG" \\\n\s+--prerelease/);
		for (const asset of ["rc/main.js", "rc/manifest.json", "rc/styles.css"]) expect(pre).toContain(asset);
	});

	it("pushes nothing and never touches master or the store release", () => {
		const pre = job("prerelease");
		expect(pre).not.toMatch(/git push|git tag|git merge|--latest|gh release edit|gh pr /);
		expect(pre).not.toContain("npm run build\n");
	});

	it("only accepts x.y.z-alpha|beta|rc.n", () => {
		const re = /grep -Eq '([^']+)'/.exec(job("prerelease"))?.[1];
		expect(re).toBeDefined();
		const rx = new RegExp(re as string);
		for (const ok of ["2.0.0-rc.2", "1.6.0-beta.1", "10.20.30-alpha.12"]) expect(rx.test(ok)).toBe(true);
		for (const bad of ["2.0.0", "2.0.0-rc", "2.0.0-rc.x", "v2.0.0-rc.1", "2.0.0-foo.1", "2.0.0-rc.1-extra"]) expect(rx.test(bad)).toBe(false);
	});
});
