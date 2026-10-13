/**
 * The one modal footer (UI consistency audit B2, owner Q7 2026-10-13:
 * "primary first"). Every modal's button row comes from `renderFooter`
 * (HexmakerModal.footer): the primary action first and the only `mod-cta`
 * on the surface, then the secondary actions, then a destructive one
 * (`mod-warning`), then Cancel. Class `duckmage-modal-footer`.
 *
 * Autosaving editors have no footer at all: × closes (owner Q5).
 * tests/uiConsistency.test.ts fails on a second primary on one surface.
 */

export interface FooterButton {
  text: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  /** Extra class (e.g. a role class tests or CSS look for). */
  cls?: string;
}

export interface FooterOptions {
  /** The commit action: first, and the surface's only mod-cta. */
  primary?: FooterButton;
  /** Other actions, plain buttons, after the primary. */
  secondary?: (FooterButton | undefined | false)[];
  /** An action that destroys or overwrites data (mod-warning). */
  destructive?: FooterButton;
  /** Back out without doing anything: a plain "Cancel" (or the given text). */
  cancel?: FooterButton | (() => void);
  /** Extra class on the row. */
  cls?: string;
}

export interface Footer {
  el: HTMLElement;
  primary?: HTMLButtonElement;
  /** Every button by its text. */
  buttons: Map<string, HTMLButtonElement>;
}

export function renderFooter(parent: HTMLElement, opts: FooterOptions): Footer {
  const el = parent.createDiv({ cls: "duckmage-modal-footer" + (opts.cls ? ` ${opts.cls}` : "") });
  const buttons = new Map<string, HTMLButtonElement>();
  const add = (b: FooterButton, cls?: string) => {
    const btn = el.createEl("button", { text: b.text, cls: [cls, b.cls].filter(Boolean).join(" ") || undefined });
    if (b.title) btn.setAttr("title", b.title);
    if (b.disabled) btn.disabled = true;
    btn.addEventListener("click", () => {
      if (!btn.disabled) b.onClick();
    });
    buttons.set(b.text, btn);
    return btn;
  };
  const primary = opts.primary ? add(opts.primary, "mod-cta") : undefined;
  for (const b of opts.secondary ?? []) if (b) add(b);
  if (opts.destructive) add(opts.destructive, "mod-warning");
  if (opts.cancel) add(typeof opts.cancel === "function" ? { text: "Cancel", onClick: opts.cancel } : opts.cancel);
  return { el, primary, buttons };
}

/**
 * A two-click guard (owner Q6: the work mode plus trash, backup or undo is
 * the safety catch; only a big-blast-radius delete keeps a guard). The
 * first click arms the button ("Click again to delete") for `ms`; a second
 * click while armed runs `onConfirm`. Returns a disarm function.
 */
export function armButton(
  btn: HTMLButtonElement,
  opts: { armedText?: string; ms?: number; onConfirm: () => void },
): () => void {
  const idle = btn.getText();
  const armedText = opts.armedText ?? "Click again to delete";
  let timer: number | null = null;
  const win = () => btn.ownerDocument.defaultView ?? activeWindow;
  const disarm = () => {
    if (timer !== null) win().clearTimeout(timer);
    timer = null;
    btn.setText(idle);
    btn.removeClass("is-armed");
  };
  btn.addEventListener("click", () => {
    if (timer === null) {
      btn.setText(armedText);
      btn.addClass("is-armed");
      timer = win().setTimeout(disarm, opts.ms ?? ARM_MS);
      return;
    }
    disarm();
    opts.onConfirm();
  });
  return disarm;
}

/** How long a two-click button stays armed. */
export const ARM_MS = 4000;
