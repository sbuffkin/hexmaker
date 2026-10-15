/**
 * Tokens on the map (L2 tokens, split out of HexMapView): the token layer
 * (grouped per hex, names, the party marked), dragging a token to another
 * hex, the party's steps in Play (visited hexes, the play log), making,
 * editing and removing tokens, and the token right-click menu (the hex's
 * own items follow it). Token data lives in the token notes' frontmatter.
 */
import { TFile, type App } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { applyTokenFrontmatter, getTokenDataFromCache, readTokenPlace, removeTokenFrontmatter, setTokenHex } from "../../frontmatter";
import { guardWrite } from "../../modeGate";
import { runPartyEntered } from "../../modules/runtime";
import { openNoteFocused } from "../../openNote";
import { markVisited, parseVisited, unmarkVisited } from "../../play/partyTravel";
import { addToPlayLog } from "../../play/playLogWriter";
import { PlayLogModal } from "../../play/PlayLogModal";
import type { MapData, TokenEntry } from "../../types";
import { getIconUrl } from "../../utils";
import { hexNeighbors } from "../hexGeometry";
import { ModeMenu } from "../modeMenu";
import { groupSize, pickTokenFill, tokenCoordShift, tokenGroupOffsets, tokenNamePlacement, tokenNameSide } from "../tokenDefaults";
import { TokenInfoModal } from "../TokenInfoModal";
import { TokenModal } from "../TokenModal";
import type { DrawingMode } from "../toolMode";
import type { TokenSnap, UndoItem } from "../undoItems";
import type { HexContextMenu } from "./hexContextMenu";
import type { MapToolbar } from "./mapToolbar";
import type { UndoController } from "./undoController";
import { hexKey, hexPair } from "../../hexKey";

export interface TokenLayerHost {
  activeMapName(): string;
  viewportEl(): HTMLElement | null;
  drawingMode(): DrawingMode | null;
  /** The token the Token tool places (picked in its dialog), and its look. */
  pendingTokenNotePath(): string | null;
  pendingTokenPlaceData(): NonNullable<TokenSnap["look"]> | null;
  getActiveMap(): MapData;
  getActiveStagger(): "odd" | "even";
  owView(map: MapData): "regions" | "biomes" | null;
  undos: Pick<UndoController, "currentWorkMode" | "pushUndo" | "pushTokenUndo">;
  /** The viewport's current CSS scale (drags move in unscaled px). */
  zoom(): number;
  toolbar: Pick<MapToolbar, "exitTokenMode">;
  hexMenu: Pick<HexContextMenu, "modeMenuOptions" | "addHexMenuItems" | "addOverworldMenuItems">;
  /** A hex click (through the view, so a wrapper on view.onHexClick sees it). */
  onHexClick(x: number, y: number, e?: MouseEvent): Promise<void>;
  centerOnHex(x: number, y: number): void;
  renderGrid(): void;
}

export class TokenLayer {
  tokenEntries: TokenEntry[] = [];
  /** The party token selected in Play (its note path): a click on a neighbouring hex moves it (SF5). */
  selectedParty: string | null = null;
  /** Where a party token was just moved, until the metadata cache has the write (path → "x_y"). */
  partyMoves = new Map<string, string>();

  constructor(private plugin: HexmakerPlugin, private host: TokenLayerHost) {}

  private get app(): App {
    return this.plugin.app;
  }

  private get activeMapName(): string {
    return this.host.activeMapName();
  }

  /** Default fill for a new token: the palette colour least used on this
   *  map, so new tokens don't all come out the same blue. */
  nextTokenFill(): string {
    this.loadTokensForMap();
    return pickTokenFill(this.tokenEntries.map((t) => t.color));
  }

  private loadTokensForMap(): void {
    this.tokenEntries = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const entry = getTokenDataFromCache(this.app, file);
      if (entry && entry.map === this.activeMapName) {
        // A party step not in the cache yet shows where it went.
        const moved = this.partyMoves.get(entry.filePath);
        if (moved !== undefined) {
          if (moved === entry.hex) this.partyMoves.delete(entry.filePath);
          else entry.hex = moved;
        }
        this.tokenEntries.push(entry);
      }
    }
  }

  private buildTokenCenterMap(gridContainer: HTMLElement): Map<string, { cx: number; cy: number }> {
    const centerMap = new Map<string, { cx: number; cy: number }>();
    gridContainer.querySelectorAll<HTMLElement>(".duckmage-hex").forEach((hexEl) => {
      const x = Number(hexEl.dataset.x);
      const y = Number(hexEl.dataset.y);
      let ox = hexEl.offsetWidth / 2, oy = hexEl.offsetHeight / 2;
      let cur: HTMLElement | null = hexEl;
      // Walk to gridContainer (NOT viewportEl) so overlay coords are
      // gridContainer-relative — the SVG is appended inside gridContainer
      // so it inherits any gridDisplay transform.
      while (cur && cur !== gridContainer) {
        ox += cur.offsetLeft;
        oy += cur.offsetTop;
        cur = cur.offsetParent as HTMLElement | null;
      }
      centerMap.set(hexKey(x, y), { cx: ox, cy: oy });
    });
    return centerMap;
  }

  renderTokenLayer(gridContainer: HTMLElement): void {
    this.drawTokenLayer(gridContainer);
    // The selected party's steps (SF5), after the tokens are read.
    this.markPartySteps(gridContainer);
  }

  private drawTokenLayer(gridContainer: HTMLElement): void {
    this.host.viewportEl()?.querySelector(".duckmage-token-layer")?.remove();
    if (this.host.getActiveMap().showTokens === false) { this.tokenEntries = []; return; }
    this.loadTokensForMap();
    if (this.tokenEntries.length === 0) return;

    const centerMap = this.buildTokenCenterMap(gridContainer);
    // Read the geometry before any write (no layout thrash).
    const firstHexEl = gridContainer.querySelector<HTMLElement>(".duckmage-hex");
    const spread = Math.min(firstHexEl?.offsetWidth ?? 64, firstHexEl?.offsetHeight ?? 64) * 0.28;
    const emPx = parseFloat(getComputedStyle(gridContainer).fontSize) || 16;
    // Token layer is a child of gridContainer (not viewportEl) so its
    // absolute-positioned tokens use the same coordinate space as
    // `buildTokenCenterMap` returns (which walks up to gridContainer).
    // Previously the layer was a viewportEl child, which made every token
    // off by exactly the viewport's `padding: 1em` — visible as
    // "tokens not centered on hexes". Matches the path / faction / region
    // overlay pattern (1.4.0 fix). Covered by
    // examples/hex-token-alignment/ in the frontend-testing suite.
    const layer = gridContainer.createDiv({ cls: "duckmage-token-layer" });
    // Spread radius (above): a fraction of the hex's short dimension so offsets scale with zoom.
    const showCoords = this.host.getActiveMap().showCoords !== false;
    const inPlay = this.host.undos.currentWorkMode() === "play";

    // Group visible tokens by hex key, preserving entry order.
    const byHex = new Map<string, TokenEntry[]>();
    for (const token of this.tokenEntries) {
      if (!token.visible) continue;
      if (!centerMap.has(token.hex)) continue;
      if (!byHex.has(token.hex)) byHex.set(token.hex, []);
      byHex.get(token.hex)!.push(token);
    }

    // Names go on the side away from the hex coordinate (F4).
    const nameSide = tokenNameSide(this.plugin.settings.coordPlacement);
    for (const [hexKey, tokens] of byHex) {
      const offsets = tokenGroupOffsets(tokens.length);
      // Off the hex's coordinate (SF5: the token hid the hex number).
      const shift = tokenCoordShift({
        placement: this.plugin.settings.coordPlacement,
        showCoords,
        emPx,
        coordFontSize: this.plugin.settings.coordFontSize,
        tokens: tokens.map((t, i) => ({ dy: offsets[i][1] * spread, size: t.size ?? "md" })),
      });
      const c0 = centerMap.get(hexKey)!;
      const center = { cx: c0.cx, cy: c0.cy + shift };

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const [odx, ody] = offsets[i];
        const size = token.size ?? "md";
        const tokenEl = layer.createDiv({
          cls: `duckmage-token duckmage-token-${token.shape} duckmage-token-size-${size}`,
        });
        tokenEl.style.left = `${center.cx + odx * spread}px`;
        tokenEl.style.top  = `${center.cy + ody * spread}px`;
        tokenEl.title      = token.party ? `${token.title} (party)` : token.title;
        if (token.party) tokenEl.addClass("is-party");
        if (token.party && inPlay && this.selectedParty === token.filePath) tokenEl.addClass("is-selected");
        if (token.color)  tokenEl.style.setProperty("--token-color",  token.color);
        if (token.border) tokenEl.style.setProperty("--token-border", token.border);

        if (token.icon) {
          const img = tokenEl.createEl("img", { cls: "duckmage-token-icon" });
          img.src = getIconUrl(this.plugin, token.icon);
          img.alt = token.title;
        } else {
          tokenEl.createSpan({
            cls: "duckmage-token-label",
            text: token.title.charAt(0).toUpperCase(),
          });
        }

        // Name under the token (N5): a sibling, not a child — hexagon
        // tokens clip their children. Hidden by the "Token names" toggle
        // except while the token is hovered (CSS). Tokens sharing a hex
        // list their names one per line under the group (no overlap).
        const place = tokenNamePlacement(offsets, i, nameSide);
        const nameEl = layer.createDiv({
          cls: `duckmage-token-name duckmage-token-name-${tokens.length > 1 ? groupSize(tokens) : size} is-${nameSide}`,
          text: token.title,
        });
        nameEl.setCssProps({
          "--duckmage-token-x": `${center.cx + place.dx * spread}px`,
          "--duckmage-token-y": `${center.cy + place.dy * spread}px`,
          "--duckmage-token-name-line": String(place.line),
        });
        if (token.color) nameEl.setCssProps({ "--token-color": token.color });
        if (tokens.length > 1) nameEl.addClass("is-stacked");

        const snapToken = { ...token }; // capture for closures

        tokenEl.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (this.host.drawingMode() !== null) return;
          this.showTokenContextMenu(e, snapToken);
        });

        // Single mousedown handler — startTokenDrag calls onClickInstead if
        // no drag occurs. A plain click opens the token's hex, like clicking
        // the hex itself: the token sits on the hex centre and used to eat
        // the click target (round 5). Its info card is in the right-click
        // menu. (With a tool on, tokens let clicks through to the hex: CSS.)
        tokenEl.addEventListener("mousedown", (e) => {
          if (e.button !== 0 || this.host.drawingMode() !== null) return;
          e.stopPropagation();
          this.startTokenDrag(snapToken, tokenEl, e, centerMap, () => {
            // Play: clicking the party picks it up (or puts it down) (SF5).
            if (snapToken.party && this.host.undos.currentWorkMode() === "play") {
              this.selectParty(this.selectedParty === snapToken.filePath ? null : snapToken.filePath);
              return;
            }
            const [hx, hy] = hexPair(snapToken.hex);
            if (Number.isFinite(hx) && Number.isFinite(hy)) void this.host.onHexClick(hx, hy, e);
          });
        });
      }
    }
  }

  /** Select the party token `path` in Play (null: none); its neighbouring hexes light up. */
  selectParty(path: string | null): void {
    this.selectedParty = path;
    this.updateTokenLayer();
  }

  /** The selected party token on this map, in Play. */
  activeParty(): TokenEntry | undefined {
    if (!this.selectedParty || this.host.undos.currentWorkMode() !== "play") return undefined;
    return this.tokenEntries.find((t) => t.filePath === this.selectedParty && t.party && t.visible);
  }

  /** Light the hexes the selected party can step to (and nothing else). */
  private markPartySteps(gridContainer: HTMLElement): void {
    gridContainer.querySelectorAll(".duckmage-party-step").forEach((el) => el.removeClass("duckmage-party-step"));
    const party = this.activeParty();
    if (!party) return;
    const [px, py] = hexPair(party.hex);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    for (const [nx, ny] of hexNeighbors(px, py, this.plugin.settings.hexOrientation, this.host.getActiveStagger())) {
      gridContainer.querySelector<HTMLElement>(`.duckmage-hex[data-x="${nx}"][data-y="${ny}"]`)?.addClass("duckmage-party-step");
    }
  }

  /** Move the party one step to `hex` (clicked or dragged) and mark both hexes visited; one undo with what modules filled. */
  async moveParty(party: TokenEntry, hex: string, dragged = false): Promise<void> {
    if (!guardWrite(party.map, "token")) return;
    const step = { map: party.map, from: party.hex, to: hex, token: party.filePath };
    this.partyMoves.set(party.filePath, hex);
    this.setVisited([step.from, hex], true);
    if (!dragged) this.updateTokenLayer();
    const moved = setTokenHex(this.app, party.filePath, hex, party.map);
    const filled = await runPartyEntered(this.plugin, step);
    const token: UndoItem = { kind: "token", path: party.filePath, before: { hex: step.from, map: party.map }, after: { hex, map: party.map } };
    this.host.undos.pushUndo(filled.length ? { kind: "group", items: [token, ...filled] } : token, party.map);
    await moved;
    if (filled.length) this.host.renderGrid();
  }

  /** Mark hexes of the open map visited (or not), saved in its map note. */
  setVisited(keys: string[], on: boolean): void {
    const map = this.host.getActiveMap();
    const before = parseVisited(map.visited);
    const after = on ? markVisited(before, ...keys) : keys.reduce((l, k) => unmarkVisited(l, k), before);
    if (after.length === before.length && after.every((k, i) => k === before[i])) return;
    map.visited = after;
    void this.plugin.saveSettings();
    this.applyVisitedMarks();
  }

  /** Visited marks ← the map's list, without a re-render. */
  private applyVisitedMarks(): void {
    const grid = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    if (!grid) return;
    const set = new Set(parseVisited(this.host.getActiveMap().visited));
    grid.querySelectorAll<HTMLElement>(".duckmage-hex").forEach((el) => {
      el.toggleClass("duckmage-hex-visited", set.has(`${el.dataset.x}_${el.dataset.y}`));
    });
  }

  /** "Add to play log…" for hex (x, y) (SF3). */
  openPlayLog(x: number, y: number): void {
    new PlayLogModal(this.app, `${this.plugin.mapLabel(this.activeMapName)} ${x}, ${y}`, (text) =>
      addToPlayLog(this.plugin, this.activeMapName, x, y, text),
    ).open();
  }

  updateTokenLayer(): void {
    const gridContainer = this.host.viewportEl()?.querySelector<HTMLElement>(
      ".duckmage-hex-map-grid",
    );
    if (!gridContainer) return;
    this.renderTokenLayer(gridContainer);
  }

  private startTokenDrag(
    token: TokenEntry,
    tokenEl: HTMLElement,
    startEvt: MouseEvent,
    centerMap: Map<string, { cx: number; cy: number }>,
    onClickInstead: () => void,
  ): void {
    const startClientX = startEvt.clientX;
    const startClientY = startEvt.clientY;
    const origLeft = parseFloat(tokenEl.style.left);
    const origTop  = parseFloat(tokenEl.style.top);
    let isDragging  = false;
    let closestHex: string | null = null;

    const onMove = (e: MouseEvent) => {
      if (!isDragging) {
        if (Math.hypot(e.clientX - startClientX, e.clientY - startClientY) < 4) return;
        isDragging = true;
        tokenEl.addClass("duckmage-token-dragging");
      }
      const dx = (e.clientX - startClientX) / this.host.zoom();
      const dy = (e.clientY - startClientY) / this.host.zoom();
      tokenEl.style.left = `${origLeft + dx}px`;
      tokenEl.style.top  = `${origTop  + dy}px`;

      const cx = origLeft + dx;
      const cy = origTop  + dy;
      let best: string | null = null;
      let bestDist = Infinity;
      for (const [key, center] of centerMap) {
        const dist = Math.hypot(center.cx - cx, center.cy - cy);
        if (dist < bestDist) { bestDist = dist; best = key; }
      }
      if (best !== closestHex) {
        if (closestHex) { const [px, py] = hexPair(closestHex); this.host.viewportEl()?.querySelector<HTMLElement>(`[data-x="${px}"][data-y="${py}"]`)?.removeClass("duckmage-token-drop-target"); }
        closestHex = best;
        if (best) { const [px, py] = hexPair(best); this.host.viewportEl()?.querySelector<HTMLElement>(`[data-x="${px}"][data-y="${py}"]`)?.addClass("duckmage-token-drop-target"); }
      }
    };

    const onUp = () => {
      activeDocument.removeEventListener("mousemove", onMove);
      activeDocument.removeEventListener("mouseup", onUp);
      tokenEl.removeClass("duckmage-token-dragging");

      if (closestHex) { const [px, py] = hexPair(closestHex); this.host.viewportEl()?.querySelector<HTMLElement>(`[data-x="${px}"][data-y="${py}"]`)?.removeClass("duckmage-token-drop-target"); }

      if (!isDragging) { onClickInstead(); return; }

      if (closestHex && closestHex !== token.hex) {
        // Snap to the new hex centre now; the cache `changed` event re-renders the layer once the
        // write lands (updateTokenLayer() here would draw the stale hex, then flicker on `changed`).
        const newCenter = centerMap.get(closestHex);
        if (newCenter) {
          tokenEl.style.left = `${newCenter.cx}px`;
          tokenEl.style.top  = `${newCenter.cy}px`;
        }
        if (guardWrite(token.map, "token")) {
          // Dragging the party still travels: both hexes count as visited (SF5), and the step explores.
          if (token.party && token.map === this.activeMapName) void this.moveParty(token, closestHex, true);
          else {
            this.host.undos.pushTokenUndo(token.filePath, token.map, { hex: token.hex, map: token.map }, { hex: closestHex, map: token.map });
            void setTokenHex(this.app, token.filePath, closestHex, token.map);
          }
        }
      } else {
        const orig = centerMap.get(token.hex);
        if (orig) {
          tokenEl.style.left = `${orig.cx}px`;
          tokenEl.style.top  = `${orig.cy}px`;
        }
      }
    };

    activeDocument.addEventListener("mousemove", onMove);
    activeDocument.addEventListener("mouseup", onUp);
  }

  private openTokenEditor(token: TokenEntry): void {
    new TokenModal(
      this.app,
      this.plugin,
      token.filePath,
      token.title,
      { icon: token.icon, shape: token.shape, size: token.size, color: token.color, border: token.border, description: token.description, party: token.party, logFolder: token.logFolder },
      (_notePath, data) => {
        void applyTokenFrontmatter(this.app, token.filePath, data)
          .then(() => this.updateTokenLayer());
      },
      () => this.removeToken(token),
    ).open();
  }

  /** A token's place and look, for undo of making or removing it. */
  private tokenSnap(token: TokenEntry): TokenSnap {
    return {
      hex: token.hex,
      map: token.map,
      visible: token.visible,
      look: { icon: token.icon, shape: token.shape, size: token.size, color: token.color, border: token.border, tokenLink: token.tokenLink, description: token.description, party: token.party, logFolder: token.logFolder ?? "" },
    };
  }

  /** Remove a token from the map (the note stays); undoable. */
  private removeToken(token: TokenEntry): void {
    if (!guardWrite(token.map, "token")) return;
    this.host.undos.pushTokenUndo(token.filePath, token.map, this.tokenSnap(token), null);
    void removeTokenFrontmatter(this.app, token.filePath)
      .then(() => this.updateTokenLayer());
  }

  private openTokenInfo(token: TokenEntry): void {
    new TokenInfoModal(
      this.app,
      token,
      (x, y) => this.host.centerOnHex(x, y),
      () => this.removeToken(token),
      () => this.openTokenEditor(token),
    ).open();
  }

  private showTokenContextMenu(evt: MouseEvent, token: TokenEntry): void {
    const menu = new ModeMenu(this.host.undos.currentWorkMode(), this.host.hexMenu.modeMenuOptions());
    menu.add("token.edit", "Edit token", "pencil", () => this.openTokenEditor(token));
    menu.add("token.info", "Token info", "info", () => this.openTokenInfo(token));
    // SF5: any token can be the party (moves by clicking a neighbour in Play).
    menu.add("token.party", "Party token", "users", () => {
      if (token.party && this.selectedParty === token.filePath) this.selectedParty = null;
      void applyTokenFrontmatter(this.app, token.filePath, { party: !token.party }).then(() => this.updateTokenLayer());
    }, { checked: !!token.party });
    menu.add("token.open-note", "Open note", "file-text", () => {
      const file = this.app.vault.getAbstractFileByPath(token.filePath);
      if (file instanceof TFile) void openNoteFocused(this.app, file);
    });
    menu.addSeparator();
    menu.add("token.remove", "Remove token", "trash", () => this.removeToken(token));
    // The token covers its hex's centre, so the hex's own items follow
    // (F8: right-clicking "where the ship is" only gave the token's menu).
    const [hx, hy] = hexPair(token.hex);
    if (token.map === this.activeMapName && Number.isFinite(hx) && Number.isFinite(hy)) {
      menu.addSeparator();
      const hexName = this.plugin.mapStore.get(this.activeMapName, hexKey(hx, hy))?.name?.trim();
      menu.addLabel(hexName ? `This hex: ${hexName}` : `This hex: ${hx}, ${hy}`);
      if (this.host.owView(this.host.getActiveMap())) this.host.hexMenu.addOverworldMenuItems(menu, evt, hx, hy);
      else this.host.hexMenu.addHexMenuItems(menu, hx, hy, true);
    }
    menu.showAtMouseEvent(evt);
  }
  /** Right-click → "Create token here": same TokenModal as the toolbar
   *  token tool, but the target hex is already known so the place-on-map
   *  step is skipped — saving writes the token frontmatter directly. */
  createTokenAtHex(x: number, y: number): void {
    new TokenModal(
      this.app,
      this.plugin,
      undefined,
      "",
      { color: this.nextTokenFill() },
      (notePath, data) => {
        void this.placeToken(notePath, { ...data }, hexKey(x, y));
      },
      undefined,
      "Create token",
    ).open();
  }

  /** Put a token (new or moved) on hex `hex` of the open map; undoable. */
  async placeToken(notePath: string, look: NonNullable<TokenSnap["look"]>, hex: string): Promise<void> {
    const map = this.activeMapName;
    if (!guardWrite(map, "token")) return;
    const was = await readTokenPlace(this.app, notePath);
    this.host.undos.pushTokenUndo(notePath, map, was, { hex, map, visible: true, look });
    await applyTokenFrontmatter(this.app, notePath, { ...look, hex, map, visible: true });
    this.updateTokenLayer();
  }

  async onHexTokenPlaceClick(x: number, y: number): Promise<void> {
    const notePath = this.host.pendingTokenNotePath();
    const look = this.host.pendingTokenPlaceData();
    if (!notePath || !look) return;
    await this.placeToken(notePath, look, hexKey(x, y));
    this.host.toolbar.exitTokenMode();
  }

  /** Put a token where a snapshot says (null: it stops being a token). */
  async applyTokenSnap(path: string, snap: TokenSnap | null): Promise<void> {
    // Undo/redo says where it is now, not a party step still on its way.
    this.partyMoves.delete(path);
    if (!snap) await removeTokenFrontmatter(this.app, path);
    else await applyTokenFrontmatter(this.app, path, { ...(snap.look ?? {}), hex: snap.hex, map: snap.map, visible: snap.visible ?? true });
    this.updateTokenLayer();
  }

}
