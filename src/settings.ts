import { App, PluginSettingTab, Setting, normalizePath, type SettingDefinitionItem } from "obsidian";
import type LecternPlugin from "./main";
import { CODE_EXTENSIONS, CODE_EXTENSION_GROUPS, OFFICE_EXTENSIONS } from "./constants";

export interface LecternSettings {
	/** Vault-relative folder that holds the `<file>.comments.md` sidecars. */
	sidecarFolder: string;
	/** Zoom a freshly opened file starts at, as a percentage. */
	defaultZoomPercent: number;
	/** Whether resolved comments are visible without toggling. */
	showResolvedByDefault: boolean;
	/** Extensions Lectern claims. Trimmed so it can coexist with other previewers. */
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
	/** Highlights and margin comments inside Obsidian's own PDF viewer. */
	pdfComments: boolean;
}

export const DEFAULT_SETTINGS: LecternSettings = {
	sidecarFolder: "File-Notes",
	defaultZoomPercent: 100,
	showResolvedByDefault: false,
	registeredExtensions: [...CODE_EXTENSIONS, ...OFFICE_EXTENSIONS],
	knownExtensions: [...CODE_EXTENSIONS, ...OFFICE_EXTENSIONS],
	showSpeakerNotes: true,
	pdfComments: true,
};


export class LecternSettingTab extends PluginSettingTab {
	private plugin: LecternPlugin;

	constructor(app: App, plugin: LecternPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Declarative, so every setting shows up in Obsidian's settings search.
	 * Plain values go through getControlValue/setControlValue below; the
	 * file-type groups render their own chips.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const groups: [string, string[]][] = [
			["Office documents", [...OFFICE_EXTENSIONS]],
			...Object.entries(CODE_EXTENSION_GROUPS).map(([label, exts]): [string, string[]] => [label, [...exts]]),
		];

		return [
			{
				name: "Comments on PDFs",
				desc: "Select text in Obsidian's PDF viewer and add a comment with the same command. Stored in the same comment folder. The PDF itself is never changed.",
				control: { type: "toggle", key: "pdfComments" },
			},
			{
				name: "Comment folder",
				desc: "Vault-relative folder for the Markdown sidecar notes that hold your comments.",
				control: { type: "text", key: "sidecarFolder", placeholder: DEFAULT_SETTINGS.sidecarFolder },
			},
			{
				name: "Default zoom",
				desc: "Zoom level a file opens at.",
				control: { type: "slider", key: "defaultZoomPercent", min: 50, max: 200, step: 10, displayFormat: (v) => `${v}%` },
			},
			{
				name: "Show resolved comments",
				desc: "Show resolved comments, dimmed, when a file opens. Either way, the Show resolved button or the \"Show or hide resolved comments\" command toggles them for the open file. In a PDF, right-click the page.",
				control: { type: "toggle", key: "showResolvedByDefault" },
			},
			{
				name: "Show speaker notes",
				desc: "Render PowerPoint speaker notes under each slide when a deck opens.",
				control: { type: "toggle", key: "showSpeakerNotes" },
			},
			{
				type: "group",
				heading: "File types",
				items: [
					{
						name: "Which extensions Lectern opens",
						desc: "Turn one off to leave it to another plugin. Changes take effect after Obsidian restarts.",
					},
					...groups.map(([label, extensions]) => ({
						name: label,
						aliases: extensions,
						render: (setting: Setting) => this.renderExtensionGroup(setting, label, extensions),
					})),
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof LecternSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		if (key === "sidecarFolder") {
			settings.sidecarFolder = normalizePath(String(value).trim() || DEFAULT_SETTINGS.sidecarFolder);
		} else {
			(settings as unknown as Record<string, unknown>)[key] = value;
		}
		await this.plugin.saveSettings();
		if (key === "pdfComments") this.plugin.pdfComments.sync();
	}

	private renderExtensionGroup(setting: Setting, label: string, extensions: string[]): void {
		const registered = new Set(this.plugin.settings.registeredExtensions);
		const allOn = extensions.every((ext) => registered.has(ext));
		const countText = () => {
			const on = new Set(this.plugin.settings.registeredExtensions);
			return `${extensions.filter((e) => on.has(e)).length} of ${extensions.length} enabled`;
		};

		setting.setName(label).setDesc(countText());
		setting.settingEl.addClass("lectern-ext-setting");
		setting.addButton((button) =>
			button.setButtonText(allOn ? "Disable all" : "Enable all").onClick(async () => {
				const next = new Set(this.plugin.settings.registeredExtensions);
				for (const ext of extensions) {
					if (allOn) next.delete(ext);
					else next.add(ext);
				}
				this.plugin.settings.registeredExtensions = [...next];
				await this.plugin.saveSettings();
				this.update();
			})
		);

		const grid = setting.settingEl.createDiv({ cls: "lectern-ext-grid" });
		for (const ext of extensions) {
			const chip = grid.createEl("label", { cls: "lectern-ext-chip" });
			const box = chip.createEl("input", { type: "checkbox" });
			box.checked = registered.has(ext);
			chip.createSpan({ text: `.${ext}` });
			box.addEventListener("change", () => {
				const next = new Set(this.plugin.settings.registeredExtensions);
				if (box.checked) next.add(ext);
				else next.delete(ext);
				this.plugin.settings.registeredExtensions = [...next];
				setting.setDesc(countText());
				void this.plugin.saveSettings();
			});
		}
	}
}
