/**
 * Which features need desktop Obsidian (Electron). The phone and tablet
 * apps have no <webview> / printToPDF, so the PDF exports are off there;
 * every Markdown and PNG export, and the whole map, work on mobile.
 * Kept free of Obsidian imports (the pure-file ratchet, unit tests): the
 * live platform is read from the `is-mobile` class Obsidian puts on <body>
 * (app.emulateMobile toggles it too).
 */
export interface PlatformLike {
  isMobile: boolean;
  isDesktopApp: boolean;
}

/** Features switched off on mobile, with the one-line reason shown to the user. */
export const DESKTOP_ONLY_FEATURES = {
  pdf: "PDF export needs the desktop app (it prints through Electron). Use the Markdown or PNG export on mobile.",
} as const;

export type DesktopOnlyFeature = keyof typeof DESKTOP_ONLY_FEATURES;

/** Is this feature available on the given platform? (Desktop app: everything.) */
export function featureAvailable(feature: DesktopOnlyFeature, p: PlatformLike): boolean {
  if (!(feature in DESKTOP_ONLY_FEATURES)) return true;
  return p.isDesktopApp && !p.isMobile;
}

/** Why a feature is off on this platform, or null when it's available. */
export function featureUnavailableReason(feature: DesktopOnlyFeature, p: PlatformLike): string | null {
  return featureAvailable(feature, p) ? null : DESKTOP_ONLY_FEATURES[feature];
}

/** The platform as Obsidian reports it on <body> (read live: emulateMobile can flip it). */
export function bodyPlatform(body: { classList?: { contains(c: string): boolean } } | null | undefined): PlatformLike {
  const isMobile = body?.classList?.contains("is-mobile") ?? false;
  return { isMobile, isDesktopApp: !isMobile };
}

/** PDF export works here. */
export function pdfAvailable(): boolean {
  return featureAvailable("pdf", bodyPlatform(typeof activeDocument === "undefined" ? null : activeDocument.body));
}

export const PDF_UNAVAILABLE_MESSAGE = DESKTOP_ONLY_FEATURES.pdf;
