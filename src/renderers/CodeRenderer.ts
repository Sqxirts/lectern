import { Notice } from "obsidian";
import hljs from "highlight.js";
import { LANGUAGE_ALIASES } from "../constants";
import { looksUndecodable } from "../util/text";
import { Renderer, type ToolbarItem } from "./Renderer";


/**
 * highlight.js returns one HTML blob for the whole file, and its spans happily
 * run across newlines (block comments, template strings). We want one DOM row
 * per line so line numbers stay glued to their code and comments can anchor to
 * a line. So walk the highlighted tree and re-emit it line by line, closing and
 * reopening the span nesting at every newline.
 */
function splitHighlightedIntoLines(source: HTMLElement): DocumentFragment[] {
	const lines: DocumentFragment[] = [];
	let line = document.createDocumentFragment();
	// Clones of the currently open spans for the line being built, outermost first.
	let path: HTMLElement[] = [];
	let cursor: Node = line;

	function startNewLine(): void {
		lines.push(line);
		line = document.createDocumentFragment();
		let parent: Node = line;
		const rebuilt: HTMLElement[] = [];
		for (const el of path) {
			const clone = el.cloneNode(false) as HTMLElement;
			parent.appendChild(clone);
			parent = clone;
			rebuilt.push(clone);
		}
		path = rebuilt;
		cursor = parent;
	}

	function walk(node: Node): void {
		for (const child of [...node.childNodes]) {
			if (child.nodeType === Node.TEXT_NODE) {
				const parts = (child.nodeValue ?? "").split("\n");
				parts.forEach((part, i) => {
					if (i > 0) startNewLine();
					if (part) cursor.appendChild(document.createTextNode(part));
				});
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				const el = child as HTMLElement;
				const clone = el.cloneNode(false) as HTMLElement;
				cursor.appendChild(clone);
				path.push(clone);
				cursor = clone;
				walk(el);
				path.pop();
				cursor = path.length ? path[path.length - 1] : line;
			}
		}
	}

	walk(source);
	lines.push(line);
	return lines;
}


export class CodeRenderer extends Renderer {
	private content = "";
	private readOnly = false;
	private editing = false;
	private textarea: HTMLTextAreaElement | null = null;
	private gutter: HTMLElement | null = null;
	private scrollSync: (() => void) | null = null;

	async render(): Promise<void> {
		this.content = await this.ctx.app.vault.read(this.ctx.file);
		this.readOnly = looksUndecodable(this.content);
		this.draw();
	}

	private draw(): void {
		this.detachScrollSync();
		this.ctx.container.empty();
		if (this.editing) this.drawEditor();
		else this.drawReadOnly();
	}

	private language(): string {
		const ext = this.ctx.file.extension.toLowerCase();
		const alias = LANGUAGE_ALIASES[ext] ?? ext;
		return hljs.getLanguage(alias) ? alias : "plaintext";
	}

	private drawReadOnly(): void {
		if (this.readOnly) {
			this.ctx.container.createDiv({
				cls: "lectern-binary-warning",
				text:
					"This file is not valid UTF-8 text, so what you see below is a lossy decode. " +
					"Editing is disabled: saving it would overwrite the original with the damaged text.",
			});
		}

		const lang = this.language();
		let highlightedHtml: string;
		try {
			highlightedHtml = hljs.highlight(this.content, { language: lang, ignoreIllegals: true }).value;
		} catch {
			// A language that fails to parse should still show the file.
			highlightedHtml = hljs.highlightAuto(this.content).value;
		}

		// highlight.js escapes all text it emits, so the only markup here is its
		// own <span class="hljs-*">. Parsing it into a detached element is just
		// how we get a tree to walk, not a trust boundary.
		const holder = document.createElement("div");
		holder.innerHTML = highlightedHtml;

		const lines = splitHighlightedIntoLines(holder);
		const grid = this.ctx.container.createDiv({ cls: "lectern-code" });

		lines.forEach((fragment, index) => {
			const lineNumber = index + 1;
			const row = grid.createDiv({ cls: "lectern-code-row" });
			row.createSpan({ cls: "lectern-code-ln", text: String(lineNumber) });
			const code = row.createEl("code", { cls: "lectern-code-text hljs" });
			code.dataset.scopeKind = "code";
			code.dataset.scopeIndex = String(lineNumber);
			code.appendChild(fragment);
		});
	}

	private drawEditor(): void {
		const wrap = this.ctx.container.createDiv({ cls: "lectern-editor" });
		this.gutter = wrap.createDiv({ cls: "lectern-editor-gutter" });

		this.textarea = wrap.createEl("textarea", { cls: "lectern-editor-area" });
		this.textarea.value = this.content;
		this.textarea.spellcheck = false;
		this.syncGutter();

		this.textarea.addEventListener("input", () => {
			this.content = this.textarea?.value ?? "";
			this.syncGutter();
		});

		// Tab should indent, not move focus out of the editor.
		this.textarea.addEventListener("keydown", (event) => {
			if (event.key !== "Tab" || !this.textarea) return;
			event.preventDefault();
			const { selectionStart, selectionEnd, value } = this.textarea;
			this.textarea.value = `${value.slice(0, selectionStart)}\t${value.slice(selectionEnd)}`;
			this.textarea.selectionStart = this.textarea.selectionEnd = selectionStart + 1;
			this.content = this.textarea.value;
			this.syncGutter();
		});

		this.scrollSync = () => {
			if (this.gutter && this.textarea) {
				this.gutter.scrollTop = this.textarea.scrollTop;
			}
		};
		this.textarea.addEventListener("scroll", this.scrollSync);
	}

	private syncGutter(): void {
		if (!this.gutter) return;
		const count = this.content.split("\n").length;
		this.gutter.empty();
		for (let i = 1; i <= count; i++) {
			this.gutter.createSpan({ text: String(i) });
		}
	}

	private detachScrollSync(): void {
		if (this.textarea && this.scrollSync) {
			this.textarea.removeEventListener("scroll", this.scrollSync);
		}
		this.scrollSync = null;
		this.textarea = null;
		this.gutter = null;
	}

	private async save(): Promise<void> {
		await this.ctx.app.vault.modify(this.ctx.file, this.content);
		new Notice(`Saved ${this.ctx.file.name}`);
		this.editing = false;
		this.draw();
		this.ctx.refreshToolbar();
	}

	toolbarItems(): ToolbarItem[] {
		if (this.editing) {
			return [
				{
					id: "save",
					label: "Save changes",
					text: "Save",
					onClick: () => this.save(),
				},
				{
					id: "cancel",
					label: "Discard changes and go back to reading",
					text: "Cancel",
					onClick: async () => {
						this.content = await this.ctx.app.vault.read(this.ctx.file);
						this.editing = false;
						this.draw();
						this.ctx.refreshToolbar();
					},
				},
			];
		}
		if (this.readOnly) return [];

		return [
			{
				id: "edit",
				label: "Edit this file",
				text: "Edit",
				onClick: () => {
					this.editing = true;
					this.draw();
					this.ctx.refreshToolbar();
				},
			},
		];
	}

	wrapperClass(): string | null {
		return this.editing ? "lectern-editing" : null;
	}

	commentingBlocked(): string | null {
		return this.editing ? "Finish editing before adding a comment." : null;
	}

	destroy(): void {
		this.detachScrollSync();
	}
}
