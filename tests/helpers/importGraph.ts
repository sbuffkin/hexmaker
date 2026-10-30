/**
 * Static import graph over src/ for the architecture ratchet tests
 * (importCycles, pureFiles). Parsed with the TypeScript compiler so
 * comments and strings never count as imports.
 *
 * A "value import" is any static import/re-export that can survive to
 * the bundle: `import type …`, `export type … from`, and imports whose
 * every named binding is `type X` are skipped. Dynamic `import()` is
 * lazy (never part of module init order) and is ignored too.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const SRC_ROOT = path.join(REPO_ROOT, "src");

/** Repo-relative, forward-slash path ("src/foo/bar.ts"). */
export function rel(abs: string): string {
	return path.relative(REPO_ROOT, abs).split(path.sep).join("/");
}

export function listSrcFiles(dir = SRC_ROOT): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listSrcFiles(full));
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(full);
	}
	return out.sort();
}

export interface ImportRef {
	specifier: string;
	/** True when the import can't reach the bundle (type-only). */
	typeOnly: boolean;
}

const importsCache = new Map<string, ImportRef[]>();

export function importsOf(file: string): ImportRef[] {
	const hit = importsCache.get(file);
	if (hit) return hit;
	const text = fs.readFileSync(file, "utf8");
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
	const out: ImportRef[] = [];
	for (const st of sf.statements) {
		if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
			const clause = st.importClause;
			let typeOnly = false;
			if (clause) {
				if (clause.isTypeOnly) typeOnly = true;
				else if (!clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
					const els = clause.namedBindings.elements;
					typeOnly = els.length > 0 && els.every((e) => e.isTypeOnly);
				}
			}
			out.push({ specifier: st.moduleSpecifier.text, typeOnly });
		} else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
			let typeOnly = st.isTypeOnly;
			if (!typeOnly && st.exportClause && ts.isNamedExports(st.exportClause)) {
				const els = st.exportClause.elements;
				typeOnly = els.length > 0 && els.every((e) => e.isTypeOnly);
			}
			out.push({ specifier: st.moduleSpecifier.text, typeOnly });
		}
	}
	importsCache.set(file, out);
	return out;
}

/** Resolve a relative specifier to a .ts file under src/, or undefined. */
export function resolveSrc(from: string, specifier: string, files: ReadonlySet<string> = new Set(listSrcFiles())): string | undefined {
	if (!specifier.startsWith(".")) return undefined;
	const base = path.resolve(path.dirname(from), specifier);
	for (const cand of [base, `${base}.ts`, path.join(base, "index.ts")]) {
		if (files.has(cand)) return cand;
	}
	return undefined;
}

let cached: Map<string, string[]> | undefined;

/** file → value-imported src files (repo-relative paths). Built once per test process. */
export function valueImportGraph(): Map<string, string[]> {
	if (cached) return cached;
	const graph = new Map<string, string[]>();
	const all = listSrcFiles();
	const files = new Set(all);
	for (const file of all) {
		const deps = new Set<string>();
		for (const imp of importsOf(file)) {
			if (imp.typeOnly) continue;
			const target = resolveSrc(file, imp.specifier, files);
			if (target) deps.add(rel(target));
		}
		graph.set(rel(file), [...deps].sort());
	}
	cached = graph;
	return graph;
}

/** Strongly connected components with more than one file (Tarjan). */
export function multiFileSccs(graph: Map<string, string[]>): string[][] {
	let index = 0;
	const idx = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const out: string[][] = [];
	const strong = (v: string): void => {
		idx.set(v, index);
		low.set(v, index);
		index++;
		stack.push(v);
		onStack.add(v);
		for (const w of graph.get(v) ?? []) {
			if (!idx.has(w)) {
				strong(w);
				low.set(v, Math.min(low.get(v)!, low.get(w)!));
			} else if (onStack.has(w)) {
				low.set(v, Math.min(low.get(v)!, idx.get(w)!));
			}
		}
		if (low.get(v) === idx.get(v)) {
			const comp: string[] = [];
			let w: string;
			do {
				w = stack.pop()!;
				onStack.delete(w);
				comp.push(w);
			} while (w !== v);
			if (comp.length > 1) out.push(comp.sort());
		}
	};
	for (const v of graph.keys()) if (!idx.has(v)) strong(v);
	return out;
}
