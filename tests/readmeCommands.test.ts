import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";

/**
 * Fresh-eyes round 3: the README named commands that don't exist
 * ("Open Hexmaker random tables"). Every command the README names must be
 * registered under exactly that name, and every registered command must be
 * in the README's list. The palette shows "<plugin name>: <command name>".
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const readme = read("../README.md");
const plugin = read("../src/HexmakerPlugin.ts");
const pluginName = (JSON.parse(read("../manifest.json")) as { name: string }).name;

const registered = [...plugin.matchAll(/addCommand\(\{\s*id:\s*"[^"]+",\s*name:\s*"([^"]+)"/g)].map((m) => m[1]);
const prefix = `${pluginName}: `;
const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentioned = [...readme.matchAll(new RegExp(`${escaped}([^*"\\n|]+?)(?=\\*\\*|"|\\s\\|)`, "g"))].map((m) => m[1].trim());

describe("README command names", () => {
	it("finds the registered commands", () => {
		expect(registered.length).toBeGreaterThan(5);
		expect(registered).toContain("Export current map…");
	});

	it("every command the README names is registered under that exact name", () => {
		expect(mentioned.length).toBeGreaterThan(0);
		for (const name of mentioned) expect(registered).toContain(name);
	});

	it("every registered command is listed in the README", () => {
		for (const name of registered) expect(readme).toContain(`**${prefix}${name}**`);
	});

	it("no stale 'Open Hexmaker …' names", () => {
		expect(readme).not.toMatch(/Open Hexmaker /);
	});
});
