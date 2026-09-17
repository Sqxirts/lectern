import { renderAsync } from "docx-preview";
import { Renderer } from "./Renderer";

const PAGE_CLASS = "vault-scope-docx-page";

export class DocxRenderer extends Renderer {
	async render(): Promise<void> {
		const buffer = await this.ctx.app.vault.readBinary(this.ctx.file);

		this.ctx.container.empty();
		const styleHost = this.ctx.container.createDiv({ cls: "vault-scope-docx-styles" });
		const body = this.ctx.container.createDiv({ cls: "vault-scope-docx-body" });

		await renderAsync(buffer, body, styleHost, {
			className: PAGE_CLASS,
			inWrapper: true,
			breakPages: true,
			ignoreLastRenderedPageBreak: false,
			renderHeaders: true,
			renderFooters: true,
			renderFootnotes: true,
			experimental: true,
		});

		this.tagPages(body);
	}

	/**
	 * docx-preview emits one <section> per laid-out page. Tagging each with the
	 * scope attributes is all the comment layer needs to know about docx.
	 */
	private tagPages(body: HTMLElement): void {
		const pages = body.querySelectorAll<HTMLElement>(`section.${PAGE_CLASS}`);
		pages.forEach((page, index) => {
			page.dataset.scopeKind = "docx";
			page.dataset.scopeIndex = String(index + 1);
		});

		// A document with no page breaks renders as a single unsectioned block.
		// Give it one scope so comments still have somewhere to land.
		if (pages.length === 0) {
			body.dataset.scopeKind = "docx";
			body.dataset.scopeIndex = "1";
		}
	}

	wrapperClass(): string | null {
		return "vault-scope-docx-active";
	}
}
