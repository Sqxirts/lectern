/**
 * An anchor says "this comment belongs to that bit of the file".
 *
 * We never write comments back into the .docx/.pptx/.xlsx itself, so an anchor
 * has to survive being re-resolved against a freshly rendered DOM every time
 * the file is opened. The quote/prefix/suffix triple is the W3C Web Annotation
 * TextQuoteSelector: store the exact text plus a little context either side,
 * then go find it again later.
 */

export const CONTEXT_CHARS = 30;

export interface QuoteAnchor {
	/** Exact text the user selected. */
	quote: string;
	/** Up to CONTEXT_CHARS immediately before the quote. */
	prefix: string;
	/** Up to CONTEXT_CHARS immediately after the quote. */
	suffix: string;
}

export interface PptxAnchor extends QuoteAnchor {
	kind: "pptx";
	/** 1-based slide number. */
	slide: number;
}

export interface DocxAnchor extends QuoteAnchor {
	kind: "docx";
	/** 1-based page number as docx-preview laid it out. */
	page: number;
}

export interface CodeAnchor extends QuoteAnchor {
	kind: "code";
	/** 1-based line number. */
	line: number;
}

/**
 * Spreadsheets get an exact address instead of a quote. A cell reference is
 * already stable, so there is nothing to re-find and nothing to orphan.
 */
export interface XlsxAnchor {
	kind: "xlsx";
	sheet: string;
	/** A1-style address, e.g. "B7". */
	cell: string;
}

export type Anchor = PptxAnchor | DocxAnchor | CodeAnchor | XlsxAnchor;

export type CommentStatus = "open" | "resolved";

export interface ScopeComment {
	id: string;
	anchor: Anchor;
	status: CommentStatus;
	/** ISO-ish local timestamp, minute precision. */
	created: string;
	/** The user's note. Markdown, may be multi-line. */
	body: string;
}

/** A comment plus whatever we learned while trying to place it in the DOM. */
export interface PlacedComment {
	comment: ScopeComment;
	/** The highlight spans we wrapped, empty when orphaned. */
	elements: HTMLElement[];
	orphaned: boolean;
}

/** Short, collision-resistant enough for a per-file list. */
export function newCommentId(): string {
	return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
}

export function nowStamp(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Human-readable location, used as the sidecar section heading. */
export function anchorLabel(anchor: Anchor): string {
	switch (anchor.kind) {
		case "pptx": return `Slide ${anchor.slide}`;
		case "docx": return `Page ${anchor.page}`;
		case "code": return `Line ${anchor.line}`;
		case "xlsx": return `${anchor.sheet}!${anchor.cell}`;
	}
}
