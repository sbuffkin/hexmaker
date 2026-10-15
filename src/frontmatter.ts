/**
 * Re-export barrel (plan-architecture-refactor, lane L10). This file used
 * to hold three modules; they now live in:
 *   - maps/hexData.ts, maps/hexFrontmatter.ts: per-hex map data (terrain,
 *     icon, GM icons, region area, name, submaps), MapStore-backed through
 *     setHexDataSource (bound in ports.ts), frontmatter fallback.
 *   - notes/areaStyle.ts, notes/areaStyleFields.ts: faction/area note
 *     colour and overlay style.
 *   - tokens/tokenNotes.ts, tokens/tokenFields.ts: token note frontmatter.
 *   - notes/frontmatterText.ts, notes/noteFrontmatter.ts: shared pieces.
 * New code should import from those files directly.
 */
export * from "./notes/frontmatterText";
export * from "./notes/noteFrontmatter";
export * from "./maps/hexFrontmatter";
export * from "./maps/hexData";
export * from "./notes/areaStyleFields";
export * from "./notes/areaStyle";
export * from "./tokens/tokenFields";
export * from "./tokens/tokenNotes";
