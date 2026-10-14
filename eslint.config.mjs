import tsparser from "@typescript-eslint/parser";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  { ignores: ["**/tests/**", "node_modules/", "*.mjs", "main.js", "dev/**"] },

  ...obsidianmd.configs.recommended,

  {
    files: ["**/*.{js,ts}"],

    languageOptions: {
      globals: {
        ...globals.browser,
        // Obsidian-injected globals for popout-window-aware code
        activeDocument: "readonly",
        activeWindow: "readonly",
        // Release slice flags (esbuild define; src/slices.d.ts).
        __SLICE_WORLDMAPS__: "readonly",
        __SLICE_SPACE__: "readonly",
        __SLICE_HEXFLOWER__: "readonly",
      },
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    plugins: {
      obsidianmd, // Explicitly include the plugin
      "@typescript-eslint": tseslint.plugin,
    },
    // You can add your own configuration to override or add rules
    rules: {
      "obsidianmd/sample-names": "off",
      "obsidianmd/ui/sentence-case": ["warn", { allowAutoFix: true }],
      // Allow console.warn/error for genuine error reporting; block debug console.log
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Enforce no-static-styles-assignment as an error so the local lint
      // breaks instead of waiting for the upstream obsidianmd reviewer bot
      // to catch it. The rule means: no direct `.style.foo = ...` and no
      // `setCssProps({ transform: ... })` for arbitrary CSS properties.
      // Set CSS custom properties (`--duckmage-...`) via setCssProps and
      // reference them from CSS rules instead.
      //
      // The other patterns the obsidianmd reviewer flags but that don't
      // have shipped rules in eslint-plugin-obsidianmd yet — `document` →
      // `activeDocument`, deprecated `setDynamicTooltip` — are documented
      // as conventions in CLAUDE.md and audited manually.
      "obsidianmd/no-static-styles-assignment": "error",
      // Reviewer-bot parity (2026-08-09): the bot runs the LATEST
      // eslint-plugin-obsidianmd plus type-aware typescript-eslint rules.
      // Keep the plugin dependency current (a stale 0.1.9 pin let 22
      // prefer-create-el sites through) and mirror the type-aware rule
      // the bot flags so local lint breaks first.
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
    },
  },
]);
