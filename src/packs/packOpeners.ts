/**
 * Open the content pack dialogs from surfaces that can't import them
 * without an import cycle (the map export form, the setup wizard): the
 * plugin sets these when it registers the pack commands (packCommands.ts).
 *
 * Pure: no Obsidian imports.
 */

let openers: { exportPack: () => void; importPack: () => void } | null = null;

export function setPackOpeners(o: { exportPack: () => void; importPack: () => void }): void {
  openers = o;
}

/** Open "Export a content pack". */
export function openPackExport(): void {
  openers?.exportPack();
}

/** Open "Import a content pack". */
export function openPackImport(): void {
  openers?.importPack();
}
