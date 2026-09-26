import { Notice } from "obsidian";
import { pptxToHtml } from "@jvmr/pptx-to-html";
import { Renderer, type ToolbarItem } from "./Renderer";
import { parseUntrustedHtml } from "../util/safeHtml";
import { deckToMarkdown, extractPptxText, slideToPlainText, type SlideText } from "../pptx/extract";
import { repairMetafileImages } from "../pptx/metafiles";
import { readSlideSize, DEFAULT_SLIDE_SIZE, type SlideSize } from "../pptx/slideSize";
import { repairCollapsedShapes } from "../pptx/thinShapes";
import { readSlideFixData, fixSlide } from "../pptx/postProcess";

export class PptxRenderer extends Renderer {
	private slides: SlideText[] = [];
	private slideEls: HTMLElement[] = [];
	private currentSlide = 1;
	private slideSize: SlideSize = DEFAULT_SLIDE_SIZE;
	private notesVisible = false;
	private observer: IntersectionObserver | null = null;

	async render(): Promise<void> {
		this.notesVisible = this.ctx.settings.showSpeakerNotes;

		const buffer = await this.ctx.app.vault.readBinary(this.ctx.file);

		// Several passes over the same file: the renderer for the visual slide,
		// our own zip walk for clean text and speaker notes it does not
		// produce, the declared slide size to frame it with, and the table data
		// (merges, styles, cell fills) it gets wrong.
		const [slidesHtml, slideText, slideSize, fixData] = await Promise.all([
			pptxToHtml(buffer),
			extractPptxText(buffer),
			readSlideSize(buffer),
			readSlideFixData(buffer),
		]);
		this.slides = slideText;
		this.slideSize = slideSize;

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
			// Size the frame from the deck's own <p:sldSz>, not from whatever
			// the renderer happened to emit. They agree for a 16:9 deck and
			// diverge for 4:3 or a custom page size.
			stage.style.width = `${this.slideSize.width}px`;
			stage.style.height = `${this.slideSize.height}px`;
			// The renderer's output is derived from a file we did not author, so
			// it is untrusted markup until safeHtml has been through it.
			stage.appendChild(parseUntrustedHtml(html));
			stage.dataset.scopeKind = "pptx";
			stage.dataset.scopeIndex = String(slideNumber);

			fixSlide(stage, fixData, index);

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

		// The renderer hands back EMF and WMF bytes labelled as PNG, which the
		// browser cannot decode. Fixing them needs to shell out, so it happens
		// after the slides are on screen rather than blocking first paint.
		void repairMetafileImages(this.ctx.container);

		// Connectors drawn flat have a zero-height box and render as nothing.
		// This needs layout to have happened, so it runs after the slides are
		// in the DOM.
		repairCollapsedShapes(this.ctx.container);

		this.watchVisibleSlide();
	}

	/**
	 * Track which slide the user is looking at, so "Copy slide" copies the one
	 * on screen rather than always the first.
	 */
	private watchVisibleSlide(): void {
		// The scroller is .vault-scope-wrapper, two levels up: container is
		// .vault-scope-content inside .vault-scope-sizer. Rooting the observer
		// at the sizer, as this used to, reports every slide as fully visible
		// because the sizer is as tall as all of them, so every ratio ties at 1,
		// the first slide always wins and "Copy slide" only ever copied slide 1.
		const scrollRoot = this.ctx.container.closest(".vault-scope-wrapper");
		if (!scrollRoot) return;

		const ratios = new Map<number, number>();
		this.observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const card = entry.target as HTMLElement;
					const index = this.slideEls.indexOf(card);
					if (index >= 0) ratios.set(index + 1, entry.intersectionRatio);
				}
				// Ratios are inserted in slide order, and the comparison is
				// strictly greater, so an exact tie keeps the earlier slide.
				// Slides that are off screen report 0 and must not win, or
				// scrolling past the last slide would jump the selection back.
				let best = this.currentSlide;
				let bestRatio = 0;
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
				text: "Speaker notes",
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
