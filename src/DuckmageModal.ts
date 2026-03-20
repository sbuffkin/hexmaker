import { App, Modal } from "obsidian";

/** Base class for all Duckmage modals. Provides shared behaviour. */
export class DuckmageModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	/** Make this modal draggable by its title-bar area. Safe to call multiple times. */
	protected makeDraggable(): void {
		const modalEl = this.modalEl;
		if (modalEl.dataset.draggable) return;
		modalEl.dataset.draggable = "1";
		modalEl.addClass("duckmage-editor-modal-drag");
		modalEl.style.position = "absolute";
		modalEl.style.left = "50%";
		modalEl.style.top = "50%";
		modalEl.style.transform = "translate(-50%, -50%)";
		modalEl.style.margin = "0";

		modalEl.addEventListener("mousedown", (e: MouseEvent) => {
			const modalContent = modalEl.querySelector<HTMLElement>(".modal-content");
			if (modalContent && e.clientY >= modalContent.getBoundingClientRect().top) return;
			if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;

			e.preventDefault();
			const r = modalEl.getBoundingClientRect();
			modalEl.style.transform = "none";
			modalEl.style.left = `${r.left}px`;
			modalEl.style.top = `${r.top}px`;
			const sx = e.clientX, sy = e.clientY;
			const ox = r.left, oy = r.top;
			const onMove = (ev: MouseEvent) => {
				modalEl.style.left = `${ox + ev.clientX - sx}px`;
				modalEl.style.top  = `${oy + ev.clientY - sy}px`;
			};
			const onUp = () => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
			};
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		});
	}
}
