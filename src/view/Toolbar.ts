import { setTooltip } from "obsidian";
import type { ToolbarItem } from "../renderers/Renderer";

/** The strip across the top of the view. Every label here is English. */
export class Toolbar {
	private el: HTMLElement;

	constructor(parent: HTMLElement) {
		this.el = parent.createDiv({ cls: "lectern-toolbar" });
	}

	render(groups: ToolbarItem[][]): void {
		this.el.empty();

		groups.filter((group) => group.length > 0).forEach((group, index) => {
			if (index > 0) this.el.createDiv({ cls: "lectern-toolbar-sep" });
			const wrap = this.el.createDiv({ cls: "lectern-toolbar-group" });
			for (const item of group) {
				this.button(wrap, item);
			}
		});
	}

	private button(parent: HTMLElement, item: ToolbarItem): void {
		const button = parent.createEl("button", {
			cls: "lectern-toolbar-btn",
			text: item.text,
		});
		setTooltip(button, item.label, { placement: "bottom" });
		button.toggleClass("is-active", item.active === true);
		button.disabled = item.disabled === true;
		button.addEventListener("click", () => void item.onClick());
	}

	/** A read-only label, used for the zoom percentage. */
	static label(text: string): ToolbarItem {
		return {
			id: `label-${text}`,
			label: text,
			text,
			onClick: () => {},
			disabled: true,
		};
	}
}
