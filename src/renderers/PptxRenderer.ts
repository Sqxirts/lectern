import { Notice } from "obsidian";
import { pptxToHtml } from "@jvmr/pptx-to-html";
import { Renderer, type ToolbarItem } from "./Renderer";
import { parseUntrustedHtml } from "../util/safeHtml";
import { deckToMarkdown, extractPptxText, slideToPlainText, type SlideText } from "../pptx/extract";

export class PptxRenderer extends Renderer {
	private slides: SlideText[] = [];
	private slideEls: HTMLElement[] = [];
	private currentSlide = 1;
	private notesVisible = false;
	private observer: IntersectionObserver | null = null;

	async render(): Promise<void> {
		this.notesVisible = this.ctx.settings.showSpeakerNotes;

		const buffer = await this.ctx.app.vault.readBinary(this.ctx.file);

		// Two passes over the same file: the renderer for the visual slide, our
		// own zip walk for clean text and speaker notes it does not produce.
		const [slidesHtml, slideText] = await Promise.all([
			pptxToHtml(buffer),
			extractPptxText(buffer),
		]);
		this.slides = slideText;

		this.ctx.container.empty();
		this.slideEls = [];

		if (slidesHtml.length === 0) {
			this.ctx.container.createDiv({ cls: "vault-scope-empty", text: "This presentation has no slides." });
			return;
		}

		slidesHtml.forEach((html, index) => {
			const slideNumber = index + 1;
			const card = this.ctx.container.createDiv({ cls: "vault-scope-slide-card" });

			const header = card.createDiv({ cls: "vault-scope-slide-header" });
			header.createSpan({ cls: "vault-scope-slide-number", text: `Slide ${slideNumber}` });

			const stage = card.createDiv({ cls: "vault-scope-slide" });
			// The renderer's output is derived from a file we did not author, so
			// it is untrusted markup until safeHtml has been through it.
			stage.appendChild(parseUntrustedHtml(html));
			stage.dataset.scopeKind = "pptx";
			stage.dataset.scopeIndex = String(slideNumber);

			const notes = this.slides[index]?.notes ?? [];
			if (notes.length > 0) {
				const panel = card.createDiv({ cls: "vault-scope-slide-notes" });
				panel.toggleClass("is-hidden", !this.notesVisible);
				panel.createDiv({ cls: "vault-scope-slide-notes-label", text: "Speaker notes" });
				for (const paragraph of notes) {
					panel.createEl("p", { text: paragraph });
				}
			}

			this.slideEls.push(card);
		});

		this.watchVisibleSlide();
	}

	/**
	 * Track which slide the user is looking at, so "Copy slide" copies the one
	 * on screen rather than always the first.
	 */
	private watchVisibleSlide(): void {
		const scrollRoot = this.ctx.container.parentElement;
		if (!scrollRoot) return;

		const ratios = new Map<number, number>();
		this.observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const card = entry.target as HTMLElement;
					const index = this.slideEls.indexOf(card);
					if (index >= 0) ratios.set(index + 1, entry.intersectionRatio);
				}
				let best = this.currentSlide;
				let bestRatio = -1;
				for (const [slide, ratio] of ratios) {
					if (ratio > bestRatio) {
						bestRatio = ratio;
						best = slide;
					}
				}
				if (best !== this.currentSlide) {
					this.currentSlide = best;
					this.ctx.refreshToolbar();
				}
			},
			{ root: scrollRoot, threshold: [0, 0.25, 0.5, 0.75, 1] }
		);

		for (const card of this.slideEls) {
			this.observer.observe(card);
		}
	}

	private async copy(text: string, what: string): Promise<void> {
		if (!text.trim()) {
			new Notice(`No text found in ${what}.`);
			return;
		}
		await navigator.clipboard.writeText(text);
		new Notice(`Copied ${what}.`);
	}

	private toggleNotes(): void {
		this.notesVisible = !this.notesVisible;
		this.ctx.container
			.querySelectorAll<HTMLElement>(".vault-scope-slide-notes")
			.forEach((panel) => panel.toggleClass("is-hidden", !this.notesVisible));
		this.ctx.refreshToolbar();
	}

	private hasNotes(): boolean {
		return this.slides.some((slide) => slide.notes.length > 0);
	}

	toolbarItems(): ToolbarItem[] {
		return [
			{
				id: "copy-slide",
				label: `Copy the text of slide ${this.currentSlide} to the clipboard`,
				text: "Copy slide",
				onClick: () => {
					const slide = this.slides[this.currentSlide - 1];
					return this.copy(slide ? slideToPlainText(slide) : "", `slide ${this.currentSlide}`);
				},
			},
			{
				id: "copy-all",
				label: "Copy every slide as markdown, one heading per slide",
				text: "Copy all",
				onClick: () => this.copy(deckToMarkdown(this.slides, this.notesVisible), "the whole deck"),
			},
			{
				id: "notes",
				label: this.hasNotes()
					? "Show or hide speaker notes"
					: "This deck has no speaker notes",
				text: "Notes",
				active: this.notesVisible,
				disabled: !this.hasNotes(),
				onClick: () => this.toggleNotes(),
			},
		];
	}

	wrapperClass(): string | null {
		return "vault-scope-pptx-active";
	}

	destroy(): void {
		this.observer?.disconnect();
		this.observer = null;
	}
}
