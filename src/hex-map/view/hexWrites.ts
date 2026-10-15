/**
 * The map view's paint writes (L2c): terrain, icon override and GM-icon
 * list, one coalescing queue each (keyed by hex note path), so rapid
 * repaints of a hex write only its latest value.
 */
import type HexmakerPlugin from "../../HexmakerPlugin";
import { setGmIconsInFile, setIconOverrideInFile, setTerrainInFile } from "../../frontmatter";
import { CoalescingWriteQueue, type WriteOutcome } from "./coalescingWriteQueue";

export interface HexWritesHost {
  plugin: HexmakerPlugin;
  /** The map being written (read when a write runs). */
  activeMapName(): string;
  viewportEl(): HTMLElement | null;
  renderGrid(): void;
  /** The queued / in-flight count changed. */
  changed(): void;
}

interface Cell { x: number; y: number }

export class HexWrites {
  readonly terrain: CoalescingWriteQueue<Cell & { terrain: string | null }>;
  readonly icon: CoalescingWriteQueue<Cell & { icon: string | null }>;
  // GM icon writes are coalesced per-hex. The value is the full list to
  // write — multi-add semantics. Empty list means "clear all GM icons."
  readonly gmIcons: CoalescingWriteQueue<Cell & { list: string[] }>;

  constructor(private host: HexWritesHost) {
    const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
    const changed = () => host.changed();
    const warn = (what: string) => (path: string, attempt: number, err: unknown) =>
      console.warn(`[duckmage] ${what} write attempt ${attempt} failed for ${path}:`, err);
    const app = host.plugin.app;
    this.terrain = new CoalescingWriteQueue({
      sleep, onChange: changed, onError: warn("terrain"),
      write: (path, { x, y, terrain }) =>
        this.writeCell(path, x, y, terrain === null, async () => {
          await setTerrainInFile(app, path, terrain);
          void host.plugin.syncHexEncounterTableLink(path, terrain);
        }),
    });
    this.icon = new CoalescingWriteQueue({
      sleep, onChange: changed, onError: warn("icon"),
      write: (path, { x, y, icon }) =>
        this.writeCell(path, x, y, icon === null, async () => { await setIconOverrideInFile(app, path, icon); }),
    });
    this.gmIcons = new CoalescingWriteQueue({
      sleep, onChange: changed, onError: warn("gm-icon"),
      write: (path, { x, y, list }) =>
        this.writeCell(path, x, y, list.length === 0, async () => { await setGmIconsInFile(app, path, list); }),
    });
  }

  /**
   * One write. Map data lives in the map note once the store is ready, so
   * painting never needs (or creates) a hex note; before that, setting a
   * value makes the hex note first (clearing one that isn't there does
   * nothing). A hex note that can't be made redraws the grid and stops.
   */
  private async writeCell(path: string, x: number, y: number, clear: boolean, write: () => Promise<void>): Promise<WriteOutcome> {
    const { plugin } = this.host;
    const onDisk = plugin.mapStore.isReady() || !!plugin.app.vault.getAbstractFileByPath(path);
    if (clear) {
      if (onDisk) await write();
      return "done";
    }
    if (!onDisk) {
      if (!(await plugin.createHexNote(x, y, this.host.activeMapName()))) {
        this.host.renderGrid();
        return "stop";
      }
      this.host
        .viewportEl()
        ?.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`)
        ?.addClass("duckmage-hex-exists");
    }
    await write();
    return "done";
  }

  /** Writes queued or in flight, all kinds (the saving indicator). */
  get count(): number {
    return this.terrain.count + this.icon.count + this.gmIcons.count;
  }

  /** Drop queued (not yet started) writes of every kind for these notes. */
  discard(paths: string[]): void {
    for (const q of [this.terrain, this.icon, this.gmIcons]) for (const p of paths) q.discard(p);
  }

  /** A write of any kind is in flight for one of these notes. */
  flushingAny(paths: string[]): boolean {
    return [this.terrain, this.icon, this.gmIcons].some((q) => paths.some((p) => q.isFlushing(p)));
  }
}
