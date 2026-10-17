/**
 * The folders the setup wizard asks for on its folders step (Advanced:
 * one path each), and the subfolder of the world folder each starts as.
 */
import { moduleWizardFolders } from "./settings/moduleSettings";

export type FolderKey =
	| "hexFolder"
	| "townsFolder"
	| "dungeonsFolder"
	| "questsFolder"
	| "featuresFolder"
	| "factionsFolder"
	| "regionsFolder"
	| "tablesFolder"
	| "workflowsFolder"
	| "templatesFolder"
	| "iconsFolder"
	/** A module's folder setting the wizard asks for (moduleWizardFolders). */
	| (string & {});

const CORE_FOLDER_KEYS: Array<{ key: FolderKey; label: string; suffix: string }> = [
	{ key: "hexFolder",       label: "Hex notes",  suffix: "hexes" },
	{ key: "townsFolder",     label: "Towns",      suffix: "towns" },
	{ key: "dungeonsFolder",  label: "Dungeons",   suffix: "dungeons" },
	{ key: "questsFolder",    label: "Quests",     suffix: "quests" },
	{ key: "featuresFolder",  label: "Features",   suffix: "features" },
	{ key: "factionsFolder",  label: "Factions",   suffix: "factions" },
	{ key: "regionsFolder",   label: "Areas",      suffix: "areas" },
	{ key: "tablesFolder",    label: "Tables",     suffix: "tables" },
	{ key: "workflowsFolder", label: "Workflows",  suffix: "workflows" },
	{ key: "templatesFolder", label: "Templates",  suffix: "templates" },
	{ key: "iconsFolder",     label: "Icons",      suffix: "icons" },
];

/**
 * The folders the wizard asks for: the core's, with the modules'
 * (SettingContribution.wizard) before Icons. Asked when used, never at
 * import time (the modules' runtimes load after the wizard's files).
 */
export function folderKeys(): Array<{ key: FolderKey; label: string; suffix: string }> {
	return [...CORE_FOLDER_KEYS.slice(0, -1), ...moduleWizardFolders(), ...CORE_FOLDER_KEYS.slice(-1)];
}
