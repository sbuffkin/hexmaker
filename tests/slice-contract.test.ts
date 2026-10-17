import { describe, it } from "node:test";
import expect from "expect";
import { MODULES, registry } from "../src/modules";
import { MODULE_RUNTIMES, moduleCommands, moduleFolderSettings } from "../src/modules/runtime";
import { PLACEMENT } from "../src/ui/placement";
import { COMMAND_ACTIONS, MENU_ACTIONS } from "../src/workMode";
import { everyModule, FLAGGED_SLICES, moduleOn, SLICES, sliceOn } from "./helpers/slices";

/**
 * The contract every slice keeps, whichever set is built (npm run
 * test:slices runs this with each slice off, the release set and none):
 * a slice built off contributes nothing the core can reach, and one built
 * on contributes all it declares.
 */
describe("slice contract: what a slice adds is there exactly when it's built", () => {
  for (const m of everyModule()) {
    const on = moduleOn(m.id);
    it(`${m.id} (slice ${m.slice}, ${on ? "on" : "off"}): registry, runtime, placement, work modes, commands`, () => {
      expect(MODULES.some((x) => x.id === m.id)).toBe(on);
      expect(MODULE_RUNTIMES.some((x) => x.id === m.id)).toBe(on);
      expect(registry.module(m.id) !== undefined).toBe(on);
      for (const id of Object.keys(m.placement ?? {})) expect({ id, placed: id in PLACEMENT }).toEqual({ id, placed: on });
      for (const id of Object.keys(m.modeActions?.commands ?? {})) expect({ id, classified: id in COMMAND_ACTIONS }).toEqual({ id, classified: on });
      for (const id of Object.keys(m.modeActions?.menus ?? {})) expect({ id, classified: id in MENU_ACTIONS }).toEqual({ id, classified: on });
      const commands = moduleCommands().map((c) => c.command.id);
      for (const id of m.owns.commands) expect({ id, registered: commands.includes(id) }).toEqual({ id, registered: on });
      const keys = moduleFolderSettings().map((d) => d.key);
      for (const k of m.owns.settingsKeys) if (keys.includes(k)) expect(on).toBe(true);
      if (m.kind) expect(registry.kindIds().includes(m.kind.id)).toBe(on);
    });
  }

  it("the flags this run built with: foundation always on, every flagged slice as its flag says", () => {
    expect(sliceOn("foundation")).toBe(true);
    for (const id of FLAGGED_SLICES) expect((globalThis as Record<string, unknown>)[SLICES[id].define!]).toBe(sliceOn(id));
    // A slice on never misses one it requires.
    for (const id of FLAGGED_SLICES) if (sliceOn(id)) for (const need of SLICES[id].requires ?? []) expect({ id, need, on: sliceOn(need) }).toEqual({ id, need, on: true });
  });
});
