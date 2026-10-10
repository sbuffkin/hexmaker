export interface PainterContextMenuOption {
  label: string;
  onClick: () => void;
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
  ) {}

  open(x: number, y: number): void {
    this.close();

    const menu = createDiv({ cls: "duckmage-painter-ctx-menu" });
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const opts: PainterContextMenuOption[] = [];
    if (this.onSwitch) opts.push({ label: this.switchLabel, onClick: this.onSwitch });
    opts.push({ label: "Exit tool", onClick: this.onExit });
    opts.push(...this.extra);

    for (const opt of opts) {
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
