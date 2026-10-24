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

/** The only event we subscribe to; `source` is the page whose text layer was rebuilt. */
export interface TextLayerRenderedEvent {
	source?: PdfPageView;
}

export interface PdfEventBus {
	_on(name: "textlayerrendered", listener: (event: TextLayerRenderedEvent) => void): void;
	_off(name: "textlayerrendered", listener: (event: TextLayerRenderedEvent) => void): void;
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

/** Read one property off something we know nothing about. */
function field(obj: unknown, key: string): unknown {
	return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>)[key] : undefined;
}

/**
 * Cross-window safe: a popout's elements fail `instanceof HTMLElement`
 * against the main window's class. Only DOM nodes carry Obsidian's
 * instanceOf, so check for it before calling it on an unknown value.
 */
const isElement = (value: unknown): value is HTMLElement =>
	fn(field(value, "instanceOf")) && (value as Node).instanceOf(HTMLElement);

/** The PDF internals behind an Obsidian view, or null if this is not a PDF view or Obsidian changed shape. */
export function probePdfInternals(view: View | null | undefined): PdfInternals | null {
	if (!view || view.getViewType() !== "pdf") return null;

	const child = field(field(view, "viewer"), "child");
	const app = field(child, "pdfViewer");
	const viewer = field(app, "pdfViewer");
	const bus = field(app, "eventBus");

	const ok =
		isElement(field(child, "containerEl")) &&
		fn(field(child, "onResize")) &&
		fn(field(bus, "_on")) &&
		fn(field(bus, "_off")) &&
		isElement(field(viewer, "container")) &&
		fn(field(viewer, "getPageView")) &&
		typeof field(viewer, "pagesCount") === "number";

	if (!ok) return null;

	// Every field above was checked, so these casts describe what is there.
	return {
		child: child as PdfInternals["child"],
		bus: bus as PdfEventBus,
		viewer: viewer as PdfInternals["viewer"],
		document: () => (field(app, "pdfDocument") as PdfDocument | undefined) ?? null,
	};
}

/**
 * True when the view is a PDF view whose internals are present but not loaded
 * yet. Used to tell "wait a moment" apart from "Obsidian changed".
 */
export function isPdfViewStillLoading(view: View | null | undefined): boolean {
	if (!view || view.getViewType() !== "pdf") return false;
	const child = field(field(view, "viewer"), "child");
	return !field(field(child, "pdfViewer"), "pdfViewer");
}
