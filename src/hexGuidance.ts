/**
 * Guidance lines in hex notes: the short italic prompt the built-in hex
 * template puts under each text section's heading ("What the party sees
 * and feels…"). They help when reading or editing the raw note, but they
 * are not the section's text: section readers (sections.ts) skip them, so
 * the hex editor, hex table and exports show an empty section until you
 * write something, and writing a section keeps its guidance line on top.
 *
 * Until fresh-eyes r4 the template put each prompt ABOVE its heading,
 * where it read as the end of the previous section. Notes made from that
 * template are unaffected (the prompt sat after the `---` that ends the
 * previous section, so no section ever included it).
 */

/** The prompts of the built-in template (src/defaultHexTemplate.md), plus older wordings. */
export const HEX_GUIDANCE = [
	"What the party sees and feels. Terrain, atmosphere, any obvious features.",
	"What the party sees and feels. Terrain, atmosphere, any obvious features. One or two sentences or a short paragraph.",
	"The visible standout feature — spire, ruin, lighthouse, statue, village — that can be spotted or used for navigation.",
	"Discoverable with exploration, tracking, or clues. Hidden lairs, ruins, tombs, camps, shortcuts.",
	"Revealed only through specific actions, NPCs, or investigation.",
	"Revealed only through specific actions, NPCs, or investigation. Havens, caches, true nature of a place.",
	"Normal for region, or special (e.g. always pleasant, sandstorms, magic zone effect).",
	"Seeds for adventures, things locals might mention, or what finding this hex could lead to.",
];

/** Compare lines ignoring case, spacing and a wrapping *emphasis* / _emphasis_. */
function norm(line: string): string {
	return line
		.trim()
		.replace(/^([*_]{1,2})(.+)\1$/, "$2")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

const GUIDANCE = new Set(HEX_GUIDANCE.map(norm));

/** Is this line one of the built-in template's guidance prompts? */
export function isGuidanceLine(line: string): boolean {
	return line.trim() !== "" && GUIDANCE.has(norm(line));
}

/**
 * Split a section body (the text after its heading) into the guidance
 * lines at its top and the rest. With no guidance, `text` is the body
 * unchanged.
 */
export function splitGuidance(body: string): { guidance: string[]; text: string } {
	const lines = body.split(/\r?\n/);
	const guidance: string[] = [];
	let i = 0;
	for (; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim()) continue;
		if (!isGuidanceLine(line)) break;
		guidance.push(line.trim());
	}
	if (!guidance.length) return { guidance, text: body };
	return { guidance, text: lines.slice(i).join("\n") };
}
