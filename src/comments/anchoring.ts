import { CONTEXT_CHARS, type Anchor } from "./types";

export const HIGHLIGHT_CLASS = "lectern-highlight";

interface TextSlice {
	node: Text;
	start: number;
	end: number;
}

interface TextMap {
	/** Concatenated text of every text node under the root, in document order. */
	text: string;
	slices: TextSlice[];
}

/** Collect the root's text nodes and the offset each one occupies in the whole. */
function buildTextMap(root: Node): TextMap {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const parent = node.parentElement;
			if (!parent) return NodeFilter.FILTER_REJECT;
			const tag = parent.tagName;
			if (tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	const slices: TextSlice[] = [];
	let text = "";
	let node = walker.nextNode() as Text | null;
	while (node) {
		const value = node.nodeValue ?? "";
		if (value.length > 0) {
			slices.push({ node, start: text.length, end: text.length + value.length });
			text += value;
		}
		node = walker.nextNode() as Text | null;
	}
	return { text, slices };
}

/** Absolute offset of a (container, offset) pair inside a text map. */
function offsetOf(map: TextMap, container: Node, offset: number): number | null {
	if (container.nodeType === Node.TEXT_NODE) {
		const slice = map.slices.find((s) => s.node === container);
		return slice ? slice.start + offset : null;
	}

	// An element container means "the boundary before child N". Two cases,
	// and conflating them is how a one-word selection silently grows to the
	// end of the slide: offset === childNodes.length means "after the last
	// child", which is the end of that element's own text, not the end of the
	// whole scope.
	if (offset >= container.childNodes.length) {
		for (let i = map.slices.length - 1; i >= 0; i--) {
			if (container.contains(map.slices[i].node)) return map.slices[i].end;
		}
		return null;
	}

	const child = container.childNodes[offset];
	for (const slice of map.slices) {
		if (slice.node === child || child.contains(slice.node)) return slice.start;
		// The child may hold no text of its own, so take the next text after it.
		if (child.compareDocumentPosition(slice.node) & Node.DOCUMENT_POSITION_FOLLOWING) {
			return slice.start;
		}
	}
	return map.text.length;
}

/**
 * Whitespace-insensitive search. Rendered HTML collapses and re-wraps
 * whitespace differently from one render to the next, so a quote stored today
 * may not match character-for-character tomorrow. Searching a normalised copy
 * while keeping a map back to the real offsets fixes that without giving up
 * exact positions.
 */
function normalise(text: string): { text: string; map: number[] } {
	const out: string[] = [];
	const map: number[] = [];
	let lastWasSpace = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (/\s/.test(char)) {
			if (lastWasSpace) continue;
			out.push(" ");
			map.push(i);
			lastWasSpace = true;
		} else {
			out.push(char);
			map.push(i);
			lastWasSpace = false;
		}
	}
	return { text: out.join(""), map };
}

/** Find `needle` in `haystack`, ignoring whitespace differences. */
export function looseIndexOf(haystack: string, needle: string, from = 0): { start: number; end: number } | null {
	const exact = haystack.indexOf(needle, from);
	if (exact >= 0) return { start: exact, end: exact + needle.length };

	const h = normalise(haystack);
	const n = normalise(needle);
	if (!n.text.trim()) return null;

	// Honour `from` here too. Without this the fallback restarted at 0, so a
	// context match on the second copy of a repeated phrase highlighted the first.
	const fromNormalised = h.map.findIndex((original) => original >= from);
	if (fromNormalised < 0) return null;
	const found = h.text.indexOf(n.text.trim(), fromNormalised);
	if (found < 0) return null;

	const start = h.map[found];
	const lastIndex = Math.min(found + n.text.trim().length - 1, h.map.length - 1);
	return { start, end: h.map[lastIndex] + 1 };
}

/**
 * Find `needle` inside haystack[start, end) only. Used to pull the quote out
 * of a prefix+quote+suffix match. Searching *from* the match start is not
 * enough: the exact-match path runs first, so a cleanly typed copy of the
 * quote further down beats the whitespace-drifted copy inside the match.
 */
export function looseIndexWithin(haystack: string, needle: string, start: number, end: number): { start: number; end: number } | null {
	const found = looseIndexOf(haystack.slice(start, end), needle);
	return found ? { start: found.start + start, end: found.end + start } : null;
}

function findScopeElement(root: HTMLElement, node: Node): HTMLElement | null {
	let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
	while (current && current !== root.parentElement) {
		if (current.instanceOf(HTMLElement) && current.dataset.scopeKind) return current;
		current = current.parentElement;
	}
	return null;
}

/** Turn a live selection into something we can store and find again later. */
export function buildAnchor(root: HTMLElement, range: Range): Anchor | null {
	const scope = findScopeElement(root, range.startContainer);
	if (!scope) return null;

	const kind = scope.dataset.scopeKind;
	const index = scope.dataset.scopeIndex ?? "";

	if (kind === "xlsx") {
		const cell = scope.dataset.cell;
		if (!cell) return null;
		return { kind: "xlsx", sheet: index, cell };
	}

	const map = buildTextMap(scope);
	const start = offsetOf(map, range.startContainer, range.startOffset);
	const end = offsetOf(map, range.endContainer, range.endOffset);
	if (start == null || end == null || end <= start) return null;

	const quote = map.text.slice(start, end).trim();
	if (!quote) return null;

	const prefix = map.text.slice(Math.max(0, start - CONTEXT_CHARS), start);
	const suffix = map.text.slice(end, end + CONTEXT_CHARS);

	switch (kind) {
		case "pptx":
			return { kind: "pptx", slide: Number(index) || 1, quote, prefix, suffix };
		case "docx":
			return { kind: "docx", page: Number(index) || 1, quote, prefix, suffix };
		case "code":
			return { kind: "code", line: Number(index) || 1, quote, prefix, suffix };
		default:
			return null;
	}
}

function scopeSelector(anchor: Anchor): string {
	switch (anchor.kind) {
		case "pptx": return `[data-scope-kind="pptx"][data-scope-index="${anchor.slide}"]`;
		// PDFs are resolved by pdfAnchoring.ts on PDF.js text items, never here.
		case "pdf": return `[data-scope-kind="pdf"][data-scope-index="${anchor.page}"]`;
		case "docx": return `[data-scope-kind="docx"][data-scope-index="${anchor.page}"]`;
		case "code": return `[data-scope-kind="code"][data-scope-index="${anchor.line}"]`;
		case "xlsx": return `[data-scope-kind="xlsx"][data-scope-index="${CSS.escape(anchor.sheet)}"][data-cell="${anchor.cell}"]`;
	}
}

/** Wrap the text between two offsets in highlight spans, one per text node crossed. */
function wrapRange(map: TextMap, start: number, end: number, commentId: string): HTMLElement[] {
	const targets: TextSlice[] = [];
	for (const slice of map.slices) {
		if (slice.end <= start || slice.start >= end) continue;
		targets.push({
			node: slice.node,
			start: Math.max(start, slice.start) - slice.start,
			end: Math.min(end, slice.end) - slice.start,
		});
	}

	// Splitting a text node shifts every later offset inside that same node, so
	// work backwards and nothing moves under us.
	const spans: HTMLElement[] = [];
	for (let i = targets.length - 1; i >= 0; i--) {
		const target = targets[i];
		let node = target.node;
		if (target.end < node.length) node.splitText(target.end);
		if (target.start > 0) node = node.splitText(target.start);

		const span = createSpan({ cls: HIGHLIGHT_CLASS });
		span.dataset.commentId = commentId;
		node.parentNode?.insertBefore(span, node);
		span.appendChild(node);
		spans.unshift(span);
	}
	return spans;
}

export interface Placement {
	elements: HTMLElement[];
	orphaned: boolean;
}

/**
 * Find an anchor's text in the rendered DOM and highlight it.
 *
 * The ladder, widest match last: exact context, then the quote inside its own
 * slide/page/line, then the quote anywhere in the file. If all three miss, the
 * comment is reported as orphaned rather than quietly dropped, so a comment is
 * never lost just because the source file moved underneath it.
 */
export function resolveAnchor(root: HTMLElement, anchor: Anchor, commentId: string): Placement {
	if (anchor.kind === "xlsx") {
		const cell = root.querySelector<HTMLElement>(scopeSelector(anchor));
		if (!cell) return { elements: [], orphaned: true };
		cell.addClass(HIGHLIGHT_CLASS);
		cell.dataset.commentId = commentId;
		return { elements: [cell], orphaned: false };
	}

	const scope = root.querySelector<HTMLElement>(scopeSelector(anchor));

	if (scope) {
		const map = buildTextMap(scope);

		// 1. prefix + quote + suffix, the strongest signal we stored.
		const withContext = looseIndexOf(map.text, `${anchor.prefix}${anchor.quote}${anchor.suffix}`);
		if (withContext) {
			const quoteAt = looseIndexWithin(map.text, anchor.quote, withContext.start, withContext.end);
			if (quoteAt) {
				return { elements: wrapRange(map, quoteAt.start, quoteAt.end, commentId), orphaned: false };
			}
		}

		// 2. The quote alone, still inside the right slide/page/line.
		const quoteOnly = looseIndexOf(map.text, anchor.quote);
		if (quoteOnly) {
			return { elements: wrapRange(map, quoteOnly.start, quoteOnly.end, commentId), orphaned: false };
		}
	}

	// 3. The quote anywhere in the file. The slide number probably changed.
	const wholeFile = buildTextMap(root);
	const anywhere = looseIndexOf(wholeFile.text, anchor.quote);
	if (anywhere) {
		return { elements: wrapRange(wholeFile, anywhere.start, anywhere.end, commentId), orphaned: false };
	}

	return { elements: [], orphaned: true };
}

/** Remove every highlight span, putting the text back as it was. */
export function clearHighlights(root: HTMLElement): void {
	root.querySelectorAll<HTMLElement>(`span.${HIGHLIGHT_CLASS}`).forEach((span) => {
		const parent = span.parentNode;
		if (!parent) return;
		while (span.firstChild) parent.insertBefore(span.firstChild, span);
		parent.removeChild(span);
		parent.normalize();
	});
	root.querySelectorAll<HTMLElement>(`td.${HIGHLIGHT_CLASS}`).forEach((cell) => {
		cell.removeClass(HIGHLIGHT_CLASS);
		delete cell.dataset.commentId;
	});
}
