/**
 * The map's touch input: one finger behaves as the mouse does, two fingers
 * pinch-zoom and pan, and a press-and-hold opens what right-click opens.
 *
 * A finger is translated into the mouse events MapInput already handles
 * (mousedown on the map, mousemove / mouseup on the document), so panning,
 * every paint tool and the path tool work on touch with no second
 * implementation. Mouse and pen input never reach this (pointerType
 * "touch" only): desktop behaviour is untouched. The compatibility mouse
 * events the browser would add after a touch are suppressed (pointerdown's
 * preventDefault), and the native Android long-press context menu is
 * swallowed in favour of ours.
 */
import type { Component } from "obsidian";
import { LongPress, pinchFrame, type PinchFrame } from "../pinchStep";
import type { MapViewport } from "./mapViewport";

export interface TouchInputHost extends Pick<Component, "registerDomEvent" | "register"> {
  viewport(): Pick<MapViewport, "pinchBy">;
}

/** Events we dispatched ourselves: the capture guard must let these through. */
const ours = new WeakSet<Event>();

function mouseEvent(doc: Document, type: string, x: number, y: number, button: number, buttons: number): MouseEvent {
  const view = doc.defaultView ?? undefined;
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button, buttons, view });
  ours.add(e);
  return e;
}

export function attachTouchInput(host: TouchInputHost, contentEl: HTMLElement, clipEl: HTMLElement): void {
  const doc = contentEl.ownerDocument;
  const pts = new Map<number, { x: number; y: number }>();
  let mode: "none" | "single" | "pinch" | "done" = "none";
  let prev: PinchFrame | null = null;
  let lastEnd = 0;
  let swallowClick = false;
  let swallowTimer: number | null = null;
  const win = () => contentEl.ownerDocument.defaultView ?? activeWindow;

  const armSwallow = () => {
    swallowClick = true;
    if (swallowTimer !== null) win().clearTimeout(swallowTimer);
    swallowTimer = null;
  };
  const releaseSwallowSoon = () => {
    if (swallowTimer !== null) win().clearTimeout(swallowTimer);
    swallowTimer = win().setTimeout(() => { swallowClick = false; swallowTimer = null; }, 400);
  };

  const stopStream = (x: number, y: number) => {
    contentEl.ownerDocument.dispatchEvent(mouseEvent(doc, "mouseup", x, y, 0, 0));
  };

  const longPress = new LongPress({
    onFire: (x, y) => {
      if (mode !== "single") return;
      stopStream(x, y);
      armSwallow();
      const at = contentEl.ownerDocument.elementFromPoint(x, y) ?? clipEl;
      try { win().navigator.vibrate?.(12); } catch { /* not everywhere */ }
      at.dispatchEvent(mouseEvent(doc, "contextmenu", x, y, 2, 0));
    },
  });
  host.register(() => longPress.cancel());

  const frame = (): PinchFrame | null => {
    const [a, b] = [...pts.values()];
    if (!a || !b) return null;
    return pinchFrame(a, b, clipEl.getBoundingClientRect());
  };

  // Obsidian mobile opens its sidebar drawers on a horizontal swipe anywhere in
  // the workspace: a map drag must not. Its swipe listener sits above the map,
  // so keep the map's touches from bubbling up to it (scrolling is handled by
  // the CSS touch-action: none, not by cancelling these).
  for (const type of ["touchstart", "touchmove", "touchend"] as const) {
    host.registerDomEvent(clipEl, type, (e: TouchEvent) => e.stopPropagation(), { passive: true });
  }

  host.registerDomEvent(contentEl, "pointerdown", (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    if (!(e.target instanceof Node) || !clipEl.contains(e.target)) return;
    e.preventDefault(); // no compatibility mouse events: we send our own
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      mode = "single";
      swallowClick = false;
      (e.target as HTMLElement).dispatchEvent(mouseEvent(doc, "mousedown", e.clientX, e.clientY, 0, 1));
      longPress.start(e.clientX, e.clientY);
    } else if (pts.size === 2) {
      longPress.cancel();
      if (mode === "single") stopStream(e.clientX, e.clientY);
      mode = "pinch";
      armSwallow();
      prev = frame();
    }
  }, { passive: false });

  host.registerDomEvent(contentEl, "pointermove", (e: PointerEvent) => {
    if (e.pointerType !== "touch" || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.preventDefault();
    if (mode === "single") {
      longPress.move(e.clientX, e.clientY);
      if (longPress.fired) return;
      doc.dispatchEvent(mouseEvent(doc, "mousemove", e.clientX, e.clientY, 0, 1));
    } else if (mode === "pinch") {
      const cur = frame();
      if (cur && prev) host.viewport().pinchBy(prev, cur);
      prev = cur;
    }
  }, { passive: false });

  // The menu a long-press opens appears under the finger: the lift that
  // follows must not click one of its items. Swallow the one click that
  // follows, wherever it lands.
  const guardLiftClick = () => {
    const swallow = (ev: Event) => { ev.preventDefault(); ev.stopImmediatePropagation(); off(); };
    const off = () => { doc.removeEventListener("click", swallow, true); win().clearTimeout(t); };
    doc.addEventListener("click", swallow, true);
    const t = win().setTimeout(off, 450);
  };

  const lift = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || !pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    lastEnd = Date.now();
    if (mode === "single") {
      const fired = longPress.fired;
      longPress.end();
      if (fired) guardLiftClick();
      else stopStream(e.clientX, e.clientY);
    } else if (mode === "pinch") {
      mode = "done"; // the remaining finger does nothing until all are up
      prev = null;
    }
    if (pts.size === 0) {
      mode = "none";
      releaseSwallowSoon();
    }
  };
  host.registerDomEvent(contentEl, "pointerup", lift);
  host.registerDomEvent(contentEl, "pointercancel", lift);

  // The browser's own long-press menu (Android) would stack on ours.
  host.registerDomEvent(contentEl, "contextmenu", (e: MouseEvent) => {
    if (ours.has(e)) return;
    if (pts.size > 0 || Date.now() - lastEnd < 700) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, { capture: true });

  // The lift after a long-press or a pinch is not a tap on a hex.
  host.registerDomEvent(contentEl, "click", (e: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true });
}
