/**
 * Redraw part of a scrolling form without the page jumping (critic C8:
 * picking a generator card rebuilt the list and the form scrolled away
 * from it). Every scrolled ancestor of `anchor` keeps its position, and
 * the element `focusAfter()` returns (the card just picked, redrawn) gets
 * the focus without scrolling and is brought just into view.
 */

/** What keepScroll needs from an element (a DOM element, or a stand-in in tests). */
export interface ScrollBox {
	parentElement: ScrollBox | null;
	scrollTop: number;
}

/** What it needs from the element to focus. */
export interface Focusable {
	focus(opts?: FocusOptions): void;
	scrollIntoView?(arg?: ScrollIntoViewOptions): void;
}

export function keepScroll(anchor: ScrollBox, redraw: () => void, focusAfter?: () => Focusable | null | undefined): void {
	const saved: [ScrollBox, number][] = [];
	for (let el = anchor.parentElement; el; el = el.parentElement) {
		if (el.scrollTop) saved.push([el, el.scrollTop]);
	}
	redraw();
	for (const [el, top] of saved) el.scrollTop = top;
	const target = focusAfter?.();
	if (!target) return;
	target.focus({ preventScroll: true });
	target.scrollIntoView?.({ block: "nearest" });
}
