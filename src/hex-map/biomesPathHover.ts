/**
 * An overworld's Biomes view: the name of a path between regions under the
 * pointer, first in the hex's tooltip (O2). Lines cross hexes through the
 * middle of their shared edge, so in the gap between two hexes the grid's
 * own tooltip names it. Once a frame, at the last pointer position.
 */

import { FrameThrottle } from "../frameThrottle";

export function watchBiomesPathHover(
  grid: HTMLElement,
  /** Names of the line under a screen point, if any. */
  pathAt: (clientX: number, clientY: number) => string | undefined,
  /** Label a hex, with the path's name first. */
  labelHex: (hexEl: HTMLElement, path: string | undefined) => void,
): void {
  const hover = new FrameThrottle((cb) => window.requestAnimationFrame(cb));
  grid.addEventListener("mousemove", (e) => {
    const { clientX, clientY, target } = e;
    hover.request(() => {
      const hexEl = (target as HTMLElement | null)?.closest<HTMLElement>(".duckmage-hex[data-x]");
      const path = pathAt(clientX, clientY);
      if (hexEl) labelHex(hexEl, path);
      else if (grid.title !== (path ?? "")) grid.title = path ?? "";
    });
  });
}
