import { placedRows, submenuRows } from "./placedMenu";

export interface PainterContextMenuOption {
  label: string;
  onClick: () => void;
  /** Placement id (src/ui/placement.ts): Advanced items go in an "Advanced ▸" submenu. */
  id?: string;
}

/** A menu row: an option, or a separator line. */
export type PainterContextMenuEntry = PainterContextMenuOption | { separator: true };

/**
 * The rows of a painter menu, top to bottom (pure): the `leading` items
 * (what's under the pointer, e.g. the path tool's path items) first, then
 * a separator, then the tool's own items: Switch (when there's a picker),
 * Exit tool, and the tool's extras. No separator without leading items.
 *
 * Leading items placed in Advanced (e.g. PathMenu.reverse) are left out of
 * that list and reached through one "Advanced ▸" row at its end (Debug ones
 * through "Debug ▸", only in debug mode); `openSubmenu` shows a submenu.
 */
export function painterMenuEntries(
  leading: readonly PainterContextMenuOption[],
  onSwitch: (() => void) | null,
  switchLabel: string,
  onExit: () => void,
  extra: readonly PainterContextMenuOption[],
  openSubmenu: (rows: PainterContextMenuOption[]) => void = () => {},
  debugMode = false,
): PainterContextMenuEntry[] {
  const tool: PainterContextMenuOption[] = [];
  if (onSwitch) tool.push({ label: switchLabel, onClick: onSwitch });
  tool.push({ label: "Exit tool", onClick: onExit });
  tool.push(...extra);
  const split = placedRows(leading, debugMode);
  const lead = [...split.shown, ...submenuRows(split, openSubmenu)];
  return lead.length ? [...lead, { separator: true }, ...tool] : tool;
}

/**
 * Lightweight right-click context menu for painter-type tools.
 * Shows "Switch" (if a picker exists for the tool) and "Exit tool" by default.
 * Subclass and override extraOptions() to inject additional tool-specific items.
 */
export class PainterContextMenu {
  private el: HTMLElement | null = null;
  private cleanupFns: Array<() => void> = [];

  constructor(
    private readonly onSwitch: (() => void) | null,
    private readonly onExit: () => void,
    private readonly switchLabel = "Switch",
    private readonly extra: PainterContextMenuOption[] = [],
    /** Items about what's under the pointer, listed first (above a separator). */
    private readonly leading: PainterContextMenuOption[] = [],
    private readonly debugMode = false,
  ) {}

  open(x: number, y: number): void {
    const entries = painterMenuEntries(this.leading, this.onSwitch, this.switchLabel, this.onExit, this.extra, (rows) => this.render(x, y, rows), this.debugMode);
    this.render(x, y, entries);
  }

  /** Show `entries` at (x, y) (the menu itself, or one of its submenus). */
  private render(x: number, y: number, entries: readonly PainterContextMenuEntry[]): void {
    this.close();

    const menu = createDiv({ cls: "duckmage-painter-ctx-menu" });
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    for (const opt of entries) {
      if ("separator" in opt) {
        menu.createDiv({ cls: "duckmage-painter-ctx-separator" });
        continue;
      }
      const item = menu.createDiv({
        cls: "duckmage-painter-ctx-item",
        text: opt.label,
      });
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        opt.onClick();
      });
    }

    activeDocument.body.appendChild(menu);
    this.el = menu;

    // Clamp to viewport after layout so the menu doesn't overflow the screen edge.
    window.requestAnimationFrame(() => {
      if (!this.el) return;
      const rect = this.el.getBoundingClientRect();
      if (rect.right > window.innerWidth)
        this.el.style.left = `${x - rect.width}px`;
      if (rect.bottom > window.innerHeight)
        this.el.style.top = `${y - rect.height}px`;
    });

    // Defer attaching close-listeners one tick so the current right-click's
    // mouseup doesn't immediately dismiss the menu.
    const timeoutId = window.setTimeout(() => {
      const onPointerDown = (e: PointerEvent) => {
        if (!this.el?.contains(e.target as Node)) this.close();
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") this.close();
      };
      const onScroll = () => this.close();

      activeDocument.addEventListener("pointerdown", onPointerDown, { capture: true });
      activeDocument.addEventListener("keydown", onKeyDown, { capture: true });
      activeDocument.addEventListener("scroll", onScroll, { capture: true, passive: true });

      this.cleanupFns.push(
        () => activeDocument.removeEventListener("pointerdown", onPointerDown, { capture: true }),
        () => activeDocument.removeEventListener("keydown", onKeyDown, { capture: true }),
        () => activeDocument.removeEventListener("scroll", onScroll, { capture: true }),
      );
    }, 0);

    this.cleanupFns.push(() => window.clearTimeout(timeoutId));
  }

  isOpen(): boolean {
    return this.el !== null;
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
  }
}
