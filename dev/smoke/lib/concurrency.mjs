/**
 * How many sandboxes the smoke suite runs at once, and how it stops them.
 *
 * Each sandbox is a whole Obsidian (Electron) with its own profile: about
 * 1.5 GB and a busy core while it loads. On a machine that is already busy
 * (another smoke run, other Obsidian windows, a build) four at once time
 * out, so the suite picks fewer. `--jobs N` overrides the pick.
 *
 * pickJobs and stopUntilGone are pure (tested in tests/smokeSuite.test.ts);
 * machineLoad reads the machine.
 */
import os from "node:os";

export const MAX_JOBS = 4;
/** Memory one sandbox needs, bytes. */
export const JOB_MEM_BYTES = 1.5 * 2 ** 30;
/** Memory left alone for everything else, bytes. */
export const RESERVE_MEM_BYTES = 2 * 2 ** 30;

/**
 * Jobs to run at once.
 * @param {{ requested?: number | null, freeMem: number, cpuBusy?: number | null, cpuCount?: number, max?: number }} m
 *   requested: --jobs (wins, within 1..max); freeMem: free bytes; cpuBusy:
 *   0..1 share of CPU in use (null = unknown); cpuCount: logical cores.
 * @returns {{ jobs: number, reason: string }}
 */
export function pickJobs({ requested = null, freeMem, cpuBusy = null, cpuCount = os.cpus().length, max = MAX_JOBS }) {
  const clamp = (n) => Math.max(1, Math.min(max, Math.floor(n)));
  if (requested !== null && requested !== undefined && Number.isFinite(Number(requested)) && Number(requested) > 0) {
    return { jobs: clamp(Number(requested)), reason: "--jobs" };
  }
  const byMem = Math.floor((freeMem - RESERVE_MEM_BYTES) / JOB_MEM_BYTES);
  // About two cores per sandbox while it loads.
  const byCores = Math.floor(cpuCount / 2);
  let byCpu = max;
  if (cpuBusy !== null && cpuBusy !== undefined) {
    if (cpuBusy >= 0.85) byCpu = 1;
    else if (cpuBusy >= 0.6) byCpu = Math.ceil(max / 2);
  }
  const jobs = clamp(Math.min(byMem, byCores, byCpu));
  const gb = (b) => (b / 2 ** 30).toFixed(1);
  const why = [`${gb(freeMem)} GB free`, `${cpuCount} cores`];
  if (cpuBusy !== null && cpuBusy !== undefined) why.push(`CPU ${Math.round(cpuBusy * 100)}% busy`);
  return { jobs, reason: why.join(", ") };
}

/** Free memory and how busy the CPU is over `sampleMs` (os.loadavg is always 0 on Windows). */
export async function machineLoad(sampleMs = 1000) {
  const times = () => os.cpus().map((c) => c.times);
  const a = times();
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = times();
  let busy = 0, total = 0;
  b.forEach((t, i) => {
    const d = (k) => t[k] - (a[i]?.[k] ?? 0);
    const all = d("user") + d("nice") + d("sys") + d("idle") + d("irq");
    busy += all - d("idle");
    total += all;
  });
  return { freeMem: os.freemem(), cpuBusy: total > 0 ? busy / total : null, cpuCount: b.length };
}

/**
 * Stop a run, and keep at it while its processes are still there: a busy
 * machine can take well over sandbox.mjs's own few seconds to let an
 * Electron go. Stop is idempotent (it only kills that run's profile).
 * @param {() => Promise<{ ok?: boolean }>} stop
 * @param {{ attempts?: number, waitMs?: number, sleep?: (ms: number) => Promise<void> }} [o]
 * @returns {Promise<{ ok?: boolean, attempts: number }>} the last result
 */
export async function stopUntilGone(stop, { attempts = 6, waitMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = { ok: false };
  for (let i = 1; i <= attempts; i++) {
    try {
      last = await stop();
    } catch (e) {
      last = { ok: false, error: String(e?.message ?? e) };
    }
    if (last.ok) return { ...last, attempts: i };
    if (i < attempts) await sleep(waitMs);
  }
  return { ...last, attempts };
}
