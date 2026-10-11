import { App, Modal } from "obsidian";
import { iconLabel, iconPack, iconPackTabs, placeIconKind, PLACE_ICON_KINDS, type IconPack } from "./utils";
import { wheelDeltaPx, wheelTarget } from "./wheelChain";
import { Disclosure, type SectionName } from "./ui/disclosure";

/** Last pack tab picked in any icon filter — remembered for the session. */
let lastIconPack: IconPack | "all" | undefined;

/** Last Places sub-group picked (Settlements, Castles…); "" = all places. */
let lastPlaceKind = "";

/** The tab a filter opens on until the user picks one (see setIconPackDefault). */
let iconPackDefault: () => IconPack | "all" = () => "all";

/**
 * Where icon filters start before the user picks a tab this session. The
 * plugin passes a getter over its settings (defaultIconPack), so a change
 * of map types applies to the next picker opened.
 */
export function setIconPackDefault(fn: () => IconPack | "all"): void {
	iconPackDefault = fn;
}

/** Base class for all Hexmaker modals. Provides shared behaviour. */
export class HexmakerModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	/**
	 * Stable id of this surface (the UI inventory's screen id, e.g.
	 * "MapModal"): keys the Advanced dropdown's remembered open state.
	 * Subclasses that use section/place set it; else the title is used.
	 */
	protected surfaceId = "";
	private disclosureState?: Disclosure;

	/** This modal's Advanced dropdown and Debug subsection (src/ui/disclosure.ts). */
	protected get disclosure(): Disclosure {
		this.disclosureState ??= new Disclosure(this.app, this.surfaceId || this.titleEl.getText() || "modal", () => this.contentEl);
		return this.disclosureState;
	}

	/**
	 * The collapsed "Advanced" dropdown at the current end of the modal
	 * (made on first use), one of its sub-sections (`"advanced/<Sub-section>"`),
	 * or the "Debug" subsection inside it: null while
	 * debug mode is off.
	 */
	protected section(layer: SectionName): HTMLElement | null {
		return this.disclosure.section(layer);
	}

	/**
	 * Put a built control where the placement map (src/ui/placement.ts)
	 * says: left in place, moved into Advanced or Debug, or removed. Returns
	 * whether it is shown.
	 */
	protected place(id: string, el: HTMLElement): boolean {
		return this.disclosure.place(id, el);
	}

	/**
	 * Put a search box + pack tabs (All / Terrain / Places / Space / Custom,
	 * with Settlements / Castles / … chips on Places) above an
	 * icon grid so large icon libraries stay navigable. Works on any grid
	 * whose tiles are `.duckmage-icon-option` elements carrying
	 * `data-icon="<file name>"`; tiles with an empty `data-icon` ("no icon",
	 * "clear all") are always shown. Tiles are filtered in place, so each
	 * grid keeps its own click/selection behaviour.
	 *
	 * `vaultIcons` is the set of icon names that come from the user's icons
	 * folder (plugin.vaultIconsSet). Returns a function that re-applies the
	 * filter — call it if the grid is re-rendered.
	 */
	protected addIconFilter(grid: HTMLElement, vaultIcons: Set<string>): () => void {
		const bar = createDiv({ cls: "duckmage-icon-filter-bar" });
		grid.before(bar);
		const search = bar.createEl("input", {
			type: "search",
			cls: "duckmage-icon-filter-search",
			attr: { placeholder: "Filter icons…", "aria-label": "Filter icons" },
		});
		const tabs = bar.createDiv({ cls: "duckmage-icon-filter-tabs" });
		// Sub-groups of the Places tab (Settlements, Castles…), shown only on it.
		const kinds = bar.createDiv({ cls: "duckmage-icon-filter-kinds" });
		const kindLabel = new Map(PLACE_ICON_KINDS);
		let placeKind = lastPlaceKind;
		const empty = createDiv({ cls: "duckmage-icon-filter-empty", text: "No icons match." });
		const NO_CUSTOM = "No custom icons yet. Put your own images (a castle, a village…) in the icons folder set in Hexmaker settings.";
		grid.after(empty);

		const tiles = (): HTMLElement[] =>
			Array.from(grid.querySelectorAll<HTMLElement>(".duckmage-icon-option[data-icon]"));

		// Full names on hover: tile captions are cut short ("ship a…"), and
		// look-alike icons can only be told apart by name (fresh-eyes round 4).
		for (const tile of tiles()) {
			const icon = tile.dataset["icon"];
			if (icon && !tile.title) tile.title = iconLabel(icon);
		}

		let pack: IconPack | "all" = lastIconPack ?? iconPackDefault();
		let opening = true;
		const apply = () => {
			const query = search.value.trim().toLowerCase();
			let shown = 0;
			for (const tile of tiles()) {
				const icon = tile.dataset["icon"] ?? "";
				if (!icon) continue;
				const kind = vaultIcons.has(icon) ? undefined : placeIconKind(icon);
				const match =
					(pack === "all" || iconPack(icon, vaultIcons) === pack) &&
					(pack !== "places" || !placeKind || kind === placeKind) &&
					(!query ||
						iconLabel(icon).includes(query) ||
						icon.toLowerCase().includes(query) ||
						(kind !== undefined && (kindLabel.get(kind) ?? "").toLowerCase().includes(query)));
				tile.toggle(match);
				if (match) shown++;
			}
			empty.setText(pack === "custom" && !query && shown === 0 ? NO_CUSTOM : "No icons match.");
			empty.toggle(shown === 0);
		};

		const renderTabs = () => {
			tabs.empty();
			const counts = new Map<IconPack, number>();
			for (const tile of tiles()) {
				const icon = tile.dataset["icon"];
				if (icon) counts.set(iconPack(icon, vaultIcons), (counts.get(iconPack(icon, vaultIcons)) ?? 0) + 1);
			}
			// Round 6 R4: the tabs always show (with Custom even when empty, so
			// it says where your own icons come from); they used to hide when
			// only one pack had icons, and the docs' tabs were nowhere to be seen.
			const entries = iconPackTabs(counts);
			if (!entries.some(([key]) => key === pack)) pack = "all";
			// Don't reopen on a tab that has nothing in it (an empty Custom).
			if (opening && pack !== "all" && !counts.get(pack)) pack = "all";
			opening = false;
			for (const [key, label, n] of entries) {
				const tab = tabs.createEl("button", {
					cls: `duckmage-icon-filter-tab${pack === key ? " is-active" : ""}`,
					text: `${label} ${n}`,
				});
				tab.addEventListener("click", () => {
					pack = key;
					lastIconPack = key;
					renderTabs();
					apply();
				});
			}
			renderKinds();
		};

		const renderKinds = () => {
			kinds.empty();
			const counts = new Map<string, number>();
			for (const tile of tiles()) {
				const icon = tile.dataset["icon"];
				const kind = icon && !vaultIcons.has(icon) ? placeIconKind(icon) : undefined;
				if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
			}
			if (!counts.get(placeKind)) placeKind = "";
			kinds.toggle(pack === "places" && counts.size > 0);
			const entries: (readonly [string, string])[] =[["", "All places"], ...PLACE_ICON_KINDS.filter(([id]) => counts.get(id))];
			for (const [id, label] of entries) {
				const chip = kinds.createEl("button", {
					cls: `duckmage-icon-filter-kind${placeKind === id ? " is-active" : ""}`,
					text: label,
				});
				chip.addEventListener("click", () => {
					placeKind = id;
					lastPlaceKind = id;
					renderKinds();
					apply();
				});
			}
		};

		search.addEventListener("input", apply);
		renderTabs();
		apply();
		return () => {
			renderTabs();
			apply();
		};
	}

	/** When the modal's own scroll pane last scrolled (see chainWheelToModal). */
	private lastOuterScroll = -Infinity;
	private outerScrollWatched = false;

	/**
	 * Stop a nested scroll area (an icon or terrain grid inside a long,
	 * scrolling modal) from trapping the mouse wheel. The modal scrolls
	 * first; the area only takes the wheel once the modal is at its end, the
	 * user has clicked into the area, or a gesture that started on the area
	 * is still going (see wheelTarget for the full rule).
	 */
	protected chainWheelToModal(inner: HTMLElement): void {
		inner.dataset["wheelChain"] = "1";
		if (!this.outerScrollWatched) {
			this.outerScrollWatched = true;
			// `scroll` doesn't bubble: capture it on the modal and ignore the
			// chained areas' own scrolling.
			this.modalEl.addEventListener(
				"scroll",
				(e) => {
					const t = e.target as HTMLElement | null;
					if (t && !t.dataset?.["wheelChain"]) this.lastOuterScroll = performance.now();
				},
				{ capture: true, passive: true },
			);
		}
		// When the wheel last scrolled this area (programmatic scrolls, like
		// bringing the current terrain into view, don't count).
		let lastInnerWheel = -Infinity;
		// Clicked into the area and still over it: the user is browsing it.
		let engaged = false;
		inner.addEventListener("pointerdown", () => { engaged = true; });
		inner.addEventListener("pointerleave", () => { engaged = false; });
		inner.addEventListener(
			"wheel",
			(e: WheelEvent) => {
				if (e.ctrlKey || e.deltaY === 0) return;
				const pane = this.scrollParentOf(inner);
				const now = performance.now();
				const box = (el: HTMLElement) => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
				const target = pane
					? wheelTarget({
						inner: box(inner),
						outer: box(pane),
						deltaY: e.deltaY,
						msSinceOuterScroll: now - this.lastOuterScroll,
						msSinceInnerScroll: now - lastInnerWheel,
						innerEngaged: engaged,
					})
					: "inner";
				if (target === "inner") {
					// Let the browser scroll the area natively.
					lastInnerWheel = now;
					return;
				}
				e.preventDefault();
				if (target === "outer" && pane) pane.scrollTop += wheelDeltaPx(e.deltaY, e.deltaMode, pane.clientHeight);
			},
			{ passive: false },
		);
	}

	/** Nearest ancestor of `el` (inside this modal) that scrolls vertically. */
	private scrollParentOf(el: HTMLElement): HTMLElement | null {
		const win = el.ownerDocument.defaultView ?? window;
		for (let p = el.parentElement; p; p = p.parentElement) {
			if (p.scrollHeight > p.clientHeight + 1) {
				const oy = win.getComputedStyle(p).overflowY;
				if (oy === "auto" || oy === "scroll") return p;
			}
			if (p === this.modalEl) break;
		}
		return null;
	}

	/** Make this modal draggable by its title-bar area. Safe to call multiple times. */
	protected makeDraggable(): void {
		const modalEl = this.modalEl;
		if (modalEl.dataset.draggable) return;
		modalEl.dataset.draggable = "1";
		modalEl.addClass("duckmage-editor-modal-drag");

		// position: fixed so the containing block is the viewport rather than
		// the nearest transform/filter/will-change ancestor. Other plugins or
		// themes can establish a containing block on a `.modal-container` ancestor
		// (issue #26 — a third-party plugin re-rooted position:absolute away from
		// the viewport, landing the modal partway off-screen).
		modalEl.setCssProps({ position: 'fixed', margin: '0' });

		const doc = modalEl.ownerDocument;
		const win = doc.defaultView ?? window;

		// Clamp the centered position so the modal can never open off-screen,
		// even if a transformed ancestor still establishes a containing block
		// for fixed positioning.
		const PADDING = 8;
		const centerInViewport = () => {
			const r = modalEl.getBoundingClientRect();
			const maxLeft = Math.max(PADDING, win.innerWidth - r.width - PADDING);
			const maxTop = Math.max(PADDING, win.innerHeight - r.height - PADDING);
			const left = Math.min(Math.max((win.innerWidth - r.width) / 2, PADDING), maxLeft);
			const top = Math.min(Math.max((win.innerHeight - r.height) / 2, PADDING), maxTop);
			modalEl.setCssProps({ left: `${left}px`, top: `${top}px` });
		};
		win.requestAnimationFrame(centerInViewport);

		modalEl.addEventListener("mousedown", (e: MouseEvent) => {
			const modalContent = modalEl.querySelector<HTMLElement>(".modal-content");
			if (modalContent && e.clientY >= modalContent.getBoundingClientRect().top) return;
			if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;

			e.preventDefault();
			const r = modalEl.getBoundingClientRect();
			modalEl.setCssProps({ left: `${r.left}px`, top: `${r.top}px` });
			const sx = e.clientX, sy = e.clientY;
			const ox = r.left, oy = r.top;
			const onMove = (ev: MouseEvent) => {
				modalEl.setCssProps({ left: `${ox + ev.clientX - sx}px`, top: `${oy + ev.clientY - sy}px` });
			};
			const onUp = () => {
				doc.removeEventListener("mousemove", onMove);
				doc.removeEventListener("mouseup", onUp);
			};
			doc.addEventListener("mousemove", onMove);
			doc.addEventListener("mouseup", onUp);
		});
	}

	/**
	 * Keep a draggable modal whose content grows after opening (generator
	 * options, preview, notes) on screen: makeDraggable fixes its top when it
	 * opens, so a taller modal ran off the bottom of the window with its
	 * buttons out of reach. Whenever it resizes, move it up just enough to
	 * fit (never above the top padding; its CSS max-height caps the rest).
	 * Returns a stop function: call it from onClose.
	 */
	protected keepInViewport(): () => void {
		const modalEl = this.modalEl;
		const win = modalEl.ownerDocument.defaultView ?? window;
		const PADDING = 8;
		const observer = new win.ResizeObserver(() => {
			const r = modalEl.getBoundingClientRect();
			const overflow = r.bottom - (win.innerHeight - PADDING);
			if (overflow > 0) modalEl.setCssProps({ top: `${Math.max(PADDING, r.top - overflow)}px` });
		});
		observer.observe(modalEl);
		return () => observer.disconnect();
	}

	/**
	 * Anchor a combo dropdown to its trigger as a viewport-`fixed` element.
	 *
	 * The dropdown markup lives inside the modal's scrolling `.modal-content`.
	 * Positioning it `absolute` there means an `overflow` ancestor clips it, so
	 * the old code switched `.modal-content` to `overflow: visible` while open —
	 * which forces a scrolled container's `scrollTop` back to 0 and snaps the
	 * whole modal to the top on the first interaction (issue #31). A `fixed`
	 * dropdown resolves its containing block to the viewport (no modal ancestor
	 * has a transform), so it escapes every `overflow` clip WITHOUT touching the
	 * scroll container — the scroll position is never disturbed.
	 *
	 * Returns `{ reposition, detach }`: call `reposition()` after the dropdown's
	 * contents change (filter typing flips its height), and `detach()` from the
	 * close path to remove the scroll/resize listeners.
	 */
	protected anchorDropdown(
		anchorEl: HTMLElement,
		dropdownEl: HTMLElement,
	): { reposition: () => void; detach: () => void } {
		const win = anchorEl.ownerDocument.defaultView ?? window;
		const GAP = 2;
		const PADDING = 8;
		const reposition = () => {
			const r = anchorEl.getBoundingClientRect();
			const below = win.innerHeight - r.bottom;
			const above = r.top;
			const dh = dropdownEl.offsetHeight;
			// Prefer dropping below; flip above only when there isn't room below
			// AND there's more room above.
			const flip = dh > below && above > below;
			const top = flip
				? Math.max(PADDING, r.top - GAP - dh)
				: r.bottom + GAP;
			dropdownEl.setCssProps({
				left: `${r.left}px`,
				top: `${top}px`,
				width: `${r.width}px`,
			});
		};
		reposition();
		const scrollPane = anchorEl.closest<HTMLElement>(".modal-content");
		scrollPane?.addEventListener("scroll", reposition, { passive: true });
		win.addEventListener("resize", reposition);
		return {
			reposition,
			detach: () => {
				scrollPane?.removeEventListener("scroll", reposition);
				win.removeEventListener("resize", reposition);
			},
		};
	}
}
