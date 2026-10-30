import { describe, it } from "node:test";
import expect from "expect";
import { moduleCommands, moduleHexTableParts, moduleSettings } from "../src/modules/runtime";
import { registry } from "../src/modules";
import { ACTION_POLICY, COMMAND_ACTIONS } from "../src/workMode";
import { parseWhen, conditionKeys } from "../src/random-tables/tableConditions";
import { parseMapNote, updateMapNote } from "../src/maps/mapNote";
import { describeWith, describeWithout } from "./helpers/slices";

/**
 * Hex fields as a slice ("fields"): declarations, the hex editor's section,
 * the hex table's columns, the settings, Recalculate fields and the filler
 * all come from the module. The `## Hexes` columns are the core's: they
 * round-trip with the slice off (no data dropped).
 */

const plugin = { settings: {} } as never;
const ids = (list: readonly { id: string }[]) => list.map((x) => x.id);

describeWith("fields", "fields on: the module's contributions", () => {
  it("Recalculate fields is its command and is classified", () => {
    expect(moduleCommands().map((c) => c.command.id)).toContain("recalculate-fields");
    expect(COMMAND_ACTIONS["recalculate-fields"]).toBe("edit-fields");
    expect(ACTION_POLICY["edit-fields"]?.modes).toEqual(["build", "god"]);
  });
  it("adds settings, a hex table part and the near condition", () => {
    expect(ids(moduleSettings())).toEqual(expect.arrayContaining(["Settings.hexFields", "Settings.placeInfluences", "Settings.hexFieldsNote"]));
    expect(moduleHexTableParts(plugin)).toHaveLength(1);
    expect(conditionKeys()).toContain("near");
    expect(parseWhen("near: town 2")[0].key).toBe("near");
  });
});

describeWithout("fields", "fields off: no trace, data kept", () => {
  it("no command, setting, table part, policy row or condition", () => {
    expect(moduleCommands().map((c) => c.command.id)).not.toContain("recalculate-fields");
    expect(ids(moduleSettings())).not.toContain("Settings.hexFields");
    expect(moduleHexTableParts(plugin)).toEqual([]);
    expect(ACTION_POLICY["edit-fields"]).toBeUndefined();
    expect(COMMAND_ACTIONS["recalculate-fields"]).toBeUndefined();
    expect(conditionKeys()).not.toContain("near");
    expect(registry.module("fields")).toBeUndefined();
  });
});

describe("## Hexes field columns round-trip whatever is built", () => {
  const NOTE = ["---", "hexmaker-map: 6", "palette: Default", "cols: 3", "rows: 3", "---", "", "## Hexes", "", "| Hex | Terrain | Population | Field rolls |", "| --- | --- | --- | --- |", "| 1_1 | grass | 250 | Population: 100 |", "| 2_1 | grass |  |  |", ""].join("\n");
  it("reads the columns as hex data and writes them back", () => {
    const read = parseMapNote(NOTE)!;
    const extra = { Population: "250", "Field rolls": "Population: 100" };
    expect(read.hexes.get("1_1")?.extra).toEqual(extra);
    read.hexes.set("2_1", { terrain: "forest" });
    const text = updateMapNote(NOTE, "m", read);
    expect(text).toContain("| Hex | Terrain | Population | Field rolls |");
    expect(parseMapNote(text)!.hexes.get("1_1")?.extra).toEqual(extra);
  });
});
