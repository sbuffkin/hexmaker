/**
 * The feature switches in the smoke suite (release-slices.json;
 * dev/release/slices.mjs): which slices a build under test has, and which
 * setups exercise slices the release build leaves out. Pure node.
 */

/** The slices a built main.js has, read from its banner ("build channel: …", "slices: [...]"); null when it doesn't say. */
export function bannerSlices(mainJs) {
  const head = String(mainJs).slice(0, 600);
  const channel = /^build channel: (.+)$/m.exec(head)?.[1]?.trim() ?? null;
  let on = null;
  const list = /^slices: (\[.*\])$/m.exec(head)?.[1];
  if (list) {
    try {
      on = JSON.parse(list);
    } catch {
      on = null;
    }
  }
  return { channel, on };
}

/**
 * The setups a release build can't fully run: those that exercise a slice
 * that isn't released (a setup's `slices`). premerge runs them on a build
 * with every slice (`--slices all`).
 */
export function unreleasedSetups(setups, slices) {
  const unreleased = new Set(Object.entries(slices).filter(([, s]) => s.define && !s.released).map(([id]) => id));
  return setups.filter((s) => (s.slices ?? []).some((id) => unreleased.has(id))).map((s) => s.id);
}

/** The stamp files of a run: last-run / last-pass, or last-run.<stamp> / last-pass.<stamp> for a named stamp ("full"). */
export function stampFiles(stamp) {
  const suffix = stamp ? `.${stamp}` : "";
  return { run: `last-run${suffix}.json`, pass: `last-pass${suffix}.json` };
}
