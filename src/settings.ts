import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultScopePlugin from "./main";
import { CODE_EXTENSIONS, CODE_EXTENSION_GROUPS, OFFICE_EXTENSIONS } from "./constants";

export interface ScopeSettings {
	/** Vault-relative folder that holds the `<file>.comments.md` sidecars. */
	sidecarFolder: string;
	/** Zoom a freshly opened file starts at, as a percentage. */
	defaultZoomPercent: number;
	/** Whether resolved comments are visible without toggling. */
	showResolvedByDefault: boolean;
	/** Extensions Vault Scope claims. Trimmed so it can coexist with other previewers. */
	registeredExtensions: string[];
	/**
	 * Every extension this vault has been offered, whether or not it is on.
	 * The difference between this and the current catalogue is what a plugin
	 * update added, which is how new extensions get enabled without resurrecting
	 * the ones the user switched off.
	 */
	knownExtensions: string[];
	/** Render pptx speaker notes under each slide on open. */
	showSpeakerNotes: boolean;
}

export const DEFAULT_SETTINGS: ScopeSettings = {
	sidecarFolder: "File-Notes",
	defaultZoomPercent: 100,
	showResolvedByDefault: false,
	registeredExtensions: [...CODE_EXTENSIONS, ...OFFICE_EXTENSIONS],
	knownExtensions: [...CODE_EXTENSIONS, ...OFFICE_EXTENSIONS],
	showSpeakerNotes: true,
};


export class ScopeSettingTab extends PluginSettingTab {
	private plugin: VaultScopePlugin;

	constructor(app: App, plugin: VaultScopePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Comment folder")
			.setDesc("Vault-relative folder for the markdown sidecar notes that hold your comments.")
			.addText((text) =>
				text
					.setPlaceholder("File-Notes")
					.setValue(this.plugin.settings.sidecarFolder)
					.onChange(async (value) => {
						this.plugin.settings.sidecarFolder = value.replace(/^\/+|\/+$/g, "") || "File-Notes";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default zoom")
			.setDesc("Zoom level a file opens at.")
			.addSlider((slider) =>
				slider
					.setLimits(50, 200, 10)
					.setValue(this.plugin.settings.defaultZoomPercent)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.defaultZoomPercent = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show resolved comments")
			.setDesc("Show resolved comments in the margin by default, dimmed. You can always toggle them from the toolbar.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showResolvedByDefault)
					.onChange(async (value) => {
						this.plugin.settings.showResolvedByDefault = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show speaker notes")
			.setDesc("Render PowerPoint speaker notes under each slide when a deck opens.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showSpeakerNotes)
					.onChange(async (value) => {
						this.plugin.settings.showSpeakerNotes = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("File types").setHeading();

		containerEl.createEl("p", {
			text: "Which extensions Vault Scope opens. Turn one off to leave it to another plugin. Changes take effect after Obsidian restarts.",
			cls: "setting-item-description",
		});

		this.addExtensionGroup(containerEl, "Office documents", [...OFFICE_EXTENSIONS]);
		for (const [label, extensions] of Object.entries(CODE_EXTENSION_GROUPS)) {
			this.addExtensionGroup(containerEl, label, [...extensions]);
		}
	}

	private addExtensionGroup(parent: HTMLElement, label: string, extensions: string[]): void {
		const setting = new Setting(parent).setName(label);
		const registered = new Set(this.plugin.settings.registeredExtensions);
		const allOn = extensions.every((ext) => registered.has(ext));

		setting.setDesc(`${extensions.filter((e) => registered.has(e)).length} of ${extensions.length} enabled`);
		setting.addButton((button) =>
			button.setButtonText(allOn ? "Disable all" : "Enable all").onClick(async () => {
				const next = new Set(this.plugin.settings.registeredExtensions);
				for (const ext of extensions) {
					if (allOn) next.delete(ext);
					else next.add(ext);
				}
				this.plugin.settings.registeredExtensions = [...next];
				await this.plugin.saveSettings();
				this.display();
			})
		);

		const grid = parent.createDiv({ cls: "vault-scope-ext-grid" });
		for (const ext of extensions) {
			const label = grid.createEl("label", { cls: "vault-scope-ext-chip" });
			const box = label.createEl("input", { type: "checkbox" });
			box.checked = registered.has(ext);
			label.createSpan({ text: `.${ext}` });
			box.addEventListener("change", async () => {
				const next = new Set(this.plugin.settings.registeredExtensions);
				if (box.checked) next.add(ext);
				else next.delete(ext);
				this.plugin.settings.registeredExtensions = [...next];
				await this.plugin.saveSettings();
			});
		}
	}
}
