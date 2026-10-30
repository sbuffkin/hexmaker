/**
 * A problem with one form field, said at the field (critic C10: "Enter a
 * map name." was only a toast while the name field was scrolled off). The
 * field is marked invalid, the message sits right under it, and the field
 * is scrolled into view and focused. Typing in it clears the message.
 *
 * One shared helper so every form says field problems the same way.
 */

const ERROR_CLS = "duckmage-field-error";
const INVALID_CLS = "duckmage-field-invalid";

/** What the helper needs from a field (an input, or a stand-in in tests). */
export interface ErrorField {
	parentElement: HTMLElement | null;
	setAttr(name: string, value: string | null): void;
	toggleClass(cls: string, on: boolean): void;
	addEventListener(type: "input", fn: () => void, opts?: { once?: boolean }): void;
	scrollIntoView?(arg?: ScrollIntoViewOptions): void;
	focus(): void;
}

/** The message element under `field`, if one is showing. */
function errorEl(field: ErrorField): HTMLElement | null {
	return field.parentElement?.querySelector<HTMLElement>(`:scope > .${ERROR_CLS}`) ?? null;
}

/** Say `message` at `field`: mark it, show the message under it, scroll to it and focus it. */
export function showFieldError(field: ErrorField, message: string): void {
	const host = field.parentElement;
	if (!host) return;
	let el = errorEl(field);
	el ??= host.createDiv({ cls: ERROR_CLS, attr: { role: "alert" } });
	el.setText(message);
	field.setAttr("aria-invalid", "true");
	field.toggleClass(INVALID_CLS, true);
	field.addEventListener("input", () => clearFieldError(field), { once: true });
	field.scrollIntoView?.({ block: "center", behavior: "smooth" });
	field.focus();
}

/** Take the message away again. */
export function clearFieldError(field: ErrorField): void {
	errorEl(field)?.remove();
	field.setAttr("aria-invalid", null);
	field.toggleClass(INVALID_CLS, false);
}
