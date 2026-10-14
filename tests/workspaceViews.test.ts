/**
 * src/workspace/views.ts: finding the open map view and showing a table
 * or workflow in the random tables view, with the same steps (and order)
 * the call sites did by hand.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { activeMapView, eachMapView, openTableInView, openWorkflowInView, type ViewWorkspace } from "../src/workspace/views";
import { VIEW_TYPE_HEX_MAP, VIEW_TYPE_RANDOM_TABLES } from "../src/constants";

interface FakeLeaf { id: string; type: string; view: { getViewType(): string; [k: string]: unknown } }

function fake(open: { id: string; type: string }[]) {
	const log: string[] = [];
	const leaves: FakeLeaf[] = [];
	const leafOf = (id: string, type: string): FakeLeaf => {
		const leaf: FakeLeaf = {
			id,
			type,
			view: {
				getViewType: () => leaf.type,
				openTable: (p: string) => log.push(`${leaf.id}.openTable ${p}`),
				openWorkflow: async (p: string) => { log.push(`${leaf.id}.openWorkflow ${p}`); },
			},
		};
		(leaf as unknown as { setViewState(s: { type: string; active?: boolean }): Promise<void> }).setViewState = async (s) => {
			log.push(`${leaf.id}.setViewState ${s.type}${s.active ? " active" : ""}`);
			leaf.type = s.type;
		};
		return leaf;
	};
	for (const o of open) leaves.push(leafOf(o.id, o.type));
	let n = 0;
	const ws = {
		getLeavesOfType: (type: string) => leaves.filter((l) => l.type === type),
		getLeaf: (how: string) => {
			const leaf = leafOf(`new${++n}`, "empty");
			leaves.push(leaf);
			log.push(`getLeaf ${how}`);
			return leaf;
		},
		revealLeaf: async (leaf: FakeLeaf) => {
			log.push(`reveal ${leaf.id}`);
			await Promise.resolve();
			log.push(`revealed ${leaf.id}`);
		},
	};
	return { ws: ws as unknown as ViewWorkspace, log };
}

describe("workspace views", () => {
	it("eachMapView / activeMapView: map views in workspace order, null when none", () => {
		const { ws } = fake([{ id: "t", type: VIEW_TYPE_RANDOM_TABLES }, { id: "m1", type: VIEW_TYPE_HEX_MAP }, { id: "m2", type: VIEW_TYPE_HEX_MAP }]);
		expect(eachMapView(ws).map((v) => (v as unknown as { getViewType(): string }).getViewType())).toEqual([VIEW_TYPE_HEX_MAP, VIEW_TYPE_HEX_MAP]);
		expect(activeMapView(ws)).toBe(eachMapView(ws)[0]);
		expect(activeMapView(fake([{ id: "t", type: VIEW_TYPE_RANDOM_TABLES }]).ws)).toBeNull();
	});

	it("openTableInView reuses the open tables view: set state, reveal (not awaited), open", async () => {
		const { ws, log } = fake([{ id: "t", type: VIEW_TYPE_RANDOM_TABLES }]);
		await openTableInView(ws, "tables/a.md");
		expect(log).toEqual([`t.setViewState ${VIEW_TYPE_RANDOM_TABLES} active`, "reveal t", "t.openTable tables/a.md", "revealed t"]);
	});

	it("openTableInView opens a tab when there's none, or always with newTab", async () => {
		const none = fake([]);
		await openTableInView(none.ws, "a.md");
		expect(none.log).toEqual(["getLeaf tab", `new1.setViewState ${VIEW_TYPE_RANDOM_TABLES} active`, "reveal new1", "new1.openTable a.md", "revealed new1"]);
		const open = fake([{ id: "t", type: VIEW_TYPE_RANDOM_TABLES }]);
		await openTableInView(open.ws, "a.md", { newTab: true });
		expect(open.log[0]).toBe("getLeaf tab");
		expect(open.log).toContain("new1.openTable a.md");
	});

	it("awaitReveal waits for the reveal before opening", async () => {
		const { ws, log } = fake([{ id: "t", type: VIEW_TYPE_RANDOM_TABLES }]);
		await openTableInView(ws, "a.md", { awaitReveal: true });
		expect(log).toEqual([`t.setViewState ${VIEW_TYPE_RANDOM_TABLES} active`, "reveal t", "revealed t", "t.openTable a.md"]);
	});

	it("openWorkflowInView shows a workflow the same way", async () => {
		const { ws, log } = fake([]);
		await openWorkflowInView(ws, "workflows/w.md");
		expect(log).toContain("new1.openWorkflow workflows/w.md");
	});
});
