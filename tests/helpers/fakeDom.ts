/**
 * A tiny fake of Obsidian's DOM helpers (createEl / createDiv / setText /
 * toggleClass …), enough to drive the shared controls in src/ui/ without a
 * browser. Timers run through `timers` so tests can fire them.
 */

export interface FakeOpts { cls?: string; text?: string; type?: string; value?: string; attr?: Record<string, string> }

export class FakeTimers {
  private next = 1;
  pending = new Map<number, () => void>();
  setTimeout = (f: () => void): number => { const id = this.next++; this.pending.set(id, f); return id; };
  clearTimeout = (id: number): void => { this.pending.delete(id); };
  /** Run every pending timer (once). */
  flush(): void { const all = [...this.pending.values()]; this.pending.clear(); for (const f of all) f(); }
}

export class FakeEl {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  text = "";
  classes = new Set<string>();
  attrs: Record<string, string> = {};
  value = "";
  disabled = false;
  title = "";
  listeners = new Map<string, ((e: unknown) => void)[]>();
  ownerDocument: { defaultView: FakeTimers };
  constructor(public tag: string, o: FakeOpts = {}, timers = new FakeTimers()) {
    this.ownerDocument = { defaultView: timers };
    for (const c of (o.cls ?? "").split(/\s+/).filter(Boolean)) this.classes.add(c);
    this.text = o.text ?? "";
    Object.assign(this.attrs, o.attr ?? {});
    if (o.type) this.attrs.type = o.type;
    if (o.value !== undefined) this.value = o.value;
  }
  get timers(): FakeTimers { return this.ownerDocument.defaultView; }
  get cls(): string { return [...this.classes].join(" "); }
  createEl(tag: string, o: FakeOpts = {}): FakeEl {
    const c = new FakeEl(tag, o, this.timers);
    c.parent = this;
    this.children.push(c);
    return c;
  }
  createDiv(o: FakeOpts = {}) { return this.createEl("div", o); }
  createSpan(o: FakeOpts = {}) { return this.createEl("span", o); }
  prepend(el: FakeEl) { this.children = [el, ...this.children.filter((c) => c !== el)]; el.parent = this; }
  empty() { this.children = []; }
  setText(t: string) { this.text = t; }
  getText() { return this.text; }
  setAttr(k: string, v: string) { this.attrs[k] = v; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addClass(c: string) { this.classes.add(c); }
  removeClass(c: string) { this.classes.delete(c); }
  hasClass(c: string) { return this.classes.has(c); }
  toggleClass(c: string, on: boolean) { if (on) this.classes.add(c); else this.classes.delete(c); }
  setCssProps() {}
  focus() {}
  select() {}
  hasPointerCapture() { return false; }
  setPointerCapture() {}
  releasePointerCapture() {}
  dispatchEvent(e: { type: string }) { this.fire(e.type, e); return true; }
  addEventListener(type: string, f: (e: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]); }
  fire(type: string, e: unknown = {}) { for (const f of this.listeners.get(type) ?? []) f(e); }
  /** Every descendant matching `pred`, in document order. */
  all(pred: (e: FakeEl) => boolean): FakeEl[] {
    return this.children.flatMap((c) => [...(pred(c) ? [c] : []), ...c.all(pred)]);
  }
  /** The first descendant with this class. */
  find(cls: string): FakeEl | undefined { return this.all((e) => e.classes.has(cls))[0]; }
  /** Every descendant of this tag (and input type). */
  inputs(type?: string): FakeEl[] { return this.all((e) => e.tag === "input" && (!type || e.attrs.type === type)); }
  buttons(): FakeEl[] { return this.all((e) => e.tag === "button"); }
}

/** A fake root element; cast to HTMLElement for the code under test. */
export function fakeRoot(): { root: FakeEl; el: HTMLElement; timers: FakeTimers } {
  const timers = new FakeTimers();
  const root = new FakeEl("div", {}, timers);
  return { root, el: root as unknown as HTMLElement, timers };
}
