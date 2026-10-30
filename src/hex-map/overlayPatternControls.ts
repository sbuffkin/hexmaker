import { Setting } from "obsidian";
import {
  type OverlayPatternKey,
  OVERLAY_PATTERN_KEYS,
  OVERLAY_PATTERN_LABELS,
  MIN_PATTERN_SCALE,
  MAX_PATTERN_SCALE,
  MIN_PATTERN_OPACITY,
  MAX_PATTERN_OPACITY,
  MIN_OUTLINE_WIDTH,
  MAX_OUTLINE_WIDTH,
  buildSvgPattern,
} from "../overlayPatterns";
import type { OverlayStyle } from "../frontmatter";
import { hexPolygonPoints } from "./hexGeometry";
import { renderLabeledSlider, sliderFormat } from "../ui/sliders";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Returns the live on-map hex width in CSS pixels; falls back to 96 if no map view is open. */
export function getOnMapHexSizePx(): number {
  const hex = activeDocument.querySelector(".duckmage-hex");
  if (hex) {
    const r = hex.getBoundingClientRect();
    if (r.width > 0) return r.width;
  }
  return 96;
}

/**
 * Render a hex-shaped preview into `container` showing what the overlay will
 * look like on the map. Replaces any existing children.
 *
 * `patternScaleMultiplier` shrinks the pattern tile so more repeats fit in a
 * small swatch. Useful for the legend/palette where the swatch is much
 * smaller than an on-map hex and the user-chosen scale would otherwise show
 * just 1-2 tile repeats.
 */
export function renderHexPreview(
  container: HTMLElement,
  opts: {
    color: string;
    style: OverlayStyle;
    orientation: "flat" | "pointy";
    hexSizePx: number;
    patternScaleMultiplier?: number;
  },
): void {
  container.replaceChildren();
  const { color, style, orientation, hexSizePx } = opts;
  const MIN_EFFECTIVE_SCALE = 4;
  const effectiveScale = Math.max(
    MIN_EFFECTIVE_SCALE,
    style.scale * (opts.patternScaleMultiplier ?? 1),
  );

  const W = hexSizePx;
  let radius: number;
  let H: number;
  if (orientation === "flat") {
    radius = W / 2;
    H = W * Math.sqrt(3) / 2;
  } else {
    radius = W / Math.sqrt(3);
    H = 2 * radius;
  }

  const PAD = 3;
  const svgW = W + 2 * PAD;
  const svgH = H + 2 * PAD;
  const cx = svgW / 2;
  const cy = svgH / 2;

  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(svgW));
  svg.setAttribute("height", String(svgH));
  svg.classList.add("duckmage-hex-preview-svg");

  // Pattern def (only if non-solid)
  let fillVal: string = color;
  if (style.pattern !== "solid") {
    const defs = activeDocument.createElementNS(SVG_NS, "defs");
    const id = `dm-prev-${Math.random().toString(36).slice(2, 9)}`;
    const pat = buildSvgPattern(activeDocument, {
      id,
      pattern: style.pattern,
      color,
      scale: effectiveScale,
    });
    if (pat) {
      defs.appendChild(pat);
      svg.appendChild(defs);
      fillVal = `url(#${id})`;
    }
  }

  const pts = hexPolygonPoints(cx, cy, orientation, radius - 1);
  const poly = activeDocument.createElementNS(SVG_NS, "polygon");
  poly.setAttribute("points", pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));
  poly.setAttribute("fill", fillVal);
  poly.setAttribute("stroke", color);
  poly.setAttribute("stroke-width", String(style.outlineWidth));
  poly.setAttribute("opacity", String(style.opacity));
  svg.appendChild(poly);

  container.appendChild(svg);
}

/**
 * Add a pattern dropdown + scale + opacity sliders + hex-shaped live preview
 * (rendered at the actual on-map hex size) to `containerEl`. Returns the live
 * state object; callers read it on Save and write to frontmatter.
 */
export function addOverlayPatternControls(
  containerEl: HTMLElement,
  initial: OverlayStyle,
  getColor: () => string,
  orientation: "flat" | "pointy",
): { state: OverlayStyle; refreshPreview: () => void } {
  const state: OverlayStyle = { ...initial };

  const previewWrap = containerEl.createDiv({ cls: "duckmage-pattern-preview-wrap" });
  previewWrap.createSpan({
    text: "Preview",
    cls: "duckmage-pattern-preview-label",
  });
  const previewHost = previewWrap.createDiv({ cls: "duckmage-pattern-preview-host" });

  const hexSizePx = getOnMapHexSizePx();
  const refreshPreview = () => {
    renderHexPreview(previewHost, {
      color: getColor(),
      style: state,
      orientation,
      hexSizePx,
    });
  };
  refreshPreview();

  new Setting(containerEl).setName("Pattern").addDropdown((dd) => {
    for (const key of OVERLAY_PATTERN_KEYS) {
      dd.addOption(key, OVERLAY_PATTERN_LABELS[key]);
    }
    dd.setValue(state.pattern).onChange((v) => {
      state.pattern = v as OverlayPatternKey;
      refreshPreview();
    });
  });

  // The shared slider (value always shown), in each setting row.
  renderLabeledSlider(new Setting(containerEl).setName("Pattern scale").controlEl, {
    label: "", ariaLabel: "Pattern scale", min: MIN_PATTERN_SCALE, max: MAX_PATTERN_SCALE, step: 1, value: state.scale,
    format: sliderFormat.px,
    onInput: (v) => { state.scale = v; refreshPreview(); },
  });
  renderLabeledSlider(new Setting(containerEl).setName("Opacity").controlEl, {
    label: "", ariaLabel: "Opacity", min: MIN_PATTERN_OPACITY, max: MAX_PATTERN_OPACITY, step: 0.05, value: state.opacity,
    format: sliderFormat.fraction,
    onInput: (v) => { state.opacity = v; refreshPreview(); },
  });
  renderLabeledSlider(new Setting(containerEl).setName("Outline width").controlEl, {
    label: "", ariaLabel: "Outline width", min: MIN_OUTLINE_WIDTH, max: MAX_OUTLINE_WIDTH, step: 0.5, value: state.outlineWidth,
    format: sliderFormat.px,
    onInput: (v) => { state.outlineWidth = v; refreshPreview(); },
  });

  return { state, refreshPreview };
}
