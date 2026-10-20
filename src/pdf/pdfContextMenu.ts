import { Menu } from "obsidian";
import type { PdfCommentController } from "./PdfCommentController";

/**
 * Adds "Highlight and comment" to the right-click menu of Obsidian's PDF viewer,
 * next to Copy / Copy as quote / Copy link to selection.
 *
 * That menu is built inside the viewer's private `onContextMenu` and fires no
 * workspace event (there is no "pdf-menu" like "editor-menu"), so the only seam
 * is the moment it is shown: wrap `Menu.prototype.showAtMouseEvent` and add our
 * item when the right-click came from a PDF page we have a controller for.
 * Checked against Obsidian 1.14.4, where the menu has a "selection" section.
 *
 * Returns an undo function. If another plugin wrapped the method after us we
 * cannot unwrap without dropping theirs, so we just go inert instead.
 */
export function patchPdfContextMenu(findController: (target: Element) => PdfCommentController | null): () => void {
	const proto = Menu.prototype;
	// eslint-disable-next-line @typescript-eslint/unbound-method -- only ever invoked as original.call(this, evt)
	const original = proto.showAtMouseEvent;
	let active = true;

	const patched = function (this: Menu, evt: MouseEvent): Menu {
		if (active) {
			try {
				addHighlightItem(this, evt, findController);
			} catch (error) {
				// Never let our item break the viewer's own menu.
				console.error("[lectern] PDF context menu", error);
			}
		}
		return original.call(this, evt);
	};
	proto.showAtMouseEvent = patched;

	return () => {
		active = false;
		if (proto.showAtMouseEvent === patched) proto.showAtMouseEvent = original;
	};
}

function addHighlightItem(menu: Menu, evt: MouseEvent, findController: (target: Element) => PdfCommentController | null): void {
	if (evt.type !== "contextmenu") return;
	const target = evt.target;
	if (!(target instanceof Element) || !target.closest(".page[data-page-number]")) return;

	const controller = findController(target);
	if (!controller) return;

	const selection = target.ownerDocument.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

	// Keep the range: if clicking the menu clears the selection, put it back
	// before the comment session reads it.
	const saved = selection.getRangeAt(0).cloneRange();

	menu.addItem((item) =>
		item
			.setSection("selection")
			.setTitle("Highlight and comment")
			.setIcon("highlighter")
			.onClick(() => {
				const live = target.ownerDocument.getSelection();
				if (live && live.isCollapsed) {
					live.removeAllRanges();
					live.addRange(saved);
				}
				controller.startComment();
			}),
	);
}
