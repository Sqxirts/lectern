import type { View } from "obsidian";

/**
 * Every private Obsidian / PDF.js field the PDF comment feature touches, in one
 * place. None of this is public API. Checked against Obsidian 1.14.4 with
 * PDF.js 5.3.34 (docs/pdf-highlights-scope.md). If any of it is missing after
 * an update, probe returns null and the feature attaches nothing, which leaves
 * Obsidian's own viewer exactly as it was.
 *
 * We read these and subscribe to the event bus. We never patch them.
 */

/** PDF.js's per-page view. Only the fields we read. */
export interface PdfPageView {
	id: number;
	div: HTMLElement;
	pdfPage?: { view: number[] };
	textLayer?: {
		div: HTMLElement;
		textLayer?: {
			textDivs: Node[];
			textContentItems: { str: string; hasEOL?: boolean; transform?: number[]; height?: number }[];
		};
	} | null;
}

export interface PdfEventBus {
	_on(name: string, listener: (event: any) => void): void;
	_off(name: string, listener: (event: any) => void): void;
}

export interface PdfInternals {
	/** Obsidian's per-file PDF controller. */
	child: { containerEl: HTMLElement; onResize(): void };
	bus: PdfEventBus;
	viewer: {
		pagesCount: number;
		container: HTMLElement;
		getPageView(index: number): PdfPageView | undefined;
	};
	/** Null until the document has loaded. */
	document(): PdfDocument | null;
}

export interface PdfDocument {
	numPages: number;
	getPage(n: number): Promise<{
		view: number[];
		getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean; transform?: number[]; height?: number }[] }>;
	}>;
}

const fn = (value: unknown): boolean => typeof value === "function";

/** The PDF internals behind an Obsidian view, or null if this is not a PDF view or Obsidian changed shape. */
export function probePdfInternals(view: View | null | undefined): PdfInternals | null {
	if (!view || view.getViewType() !== "pdf") return null;

	const child = (view as any).viewer?.child;
	const app = child?.pdfViewer;
	const viewer = app?.pdfViewer;
	const bus = app?.eventBus;

	const ok =
		child?.containerEl instanceof HTMLElement &&
		fn(child.onResize) &&
		fn(bus?._on) &&
		fn(bus?._off) &&
		viewer?.container instanceof HTMLElement &&
		fn(viewer.getPageView) &&
		typeof viewer.pagesCount === "number";

	if (!ok) return null;

	return {
		child,
		bus,
		viewer,
		document: () => app.pdfDocument ?? null,
	};
}

/**
 * True when the view is a PDF view whose internals are present but not loaded
 * yet. Used to tell "wait a moment" apart from "Obsidian changed".
 */
export function isPdfViewStillLoading(view: View | null | undefined): boolean {
	if (!view || view.getViewType() !== "pdf") return false;
	const child = (view as any).viewer?.child;
	return !child?.pdfViewer?.pdfViewer;
}
