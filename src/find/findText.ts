/**
 * Text search over rendered DOM, kept free of Obsidian imports so it runs
 * under jsdom in the tests.
 *
 * Matches come back as offsets into one joined string, then get turned into
 * Ranges. Ranges let the find bar paint with the CSS Custom Highlight API
 * instead of wrapping text in spans: comment highlights already wrap spans,
 * and two features splitting the same text nodes would keep breaking each
 * other's anchors.
 */

interface TextSlice {
	node: Text;
	start: number;
	end: number;
}

export interface SearchText {
	/** Every searchable text node joined in document order. */
	text: string;
	slices: TextSlice[];
}

export interface TextMatch {
	start: number;
	end: number;
}

export interface FindOptions {
	matchCase: boolean;
	/** Stop after this many matches. A one-letter query on a long deck can hit tens of thousands. */
	limit: number;
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA"]);

/**
 * Elements whose start begins a new line of text. A newline goes into the
 * joined string between them, so "end of one line" + "start of the next"
 * can't read as a match the user never sees on one line.
 */
const BLOCK_SELECTOR = "p, div, li, td, th, tr, h1, h2, h3, h4, h5, h6, pre, blockquote, section, article";

/**
 * Collect the searchable text under `root`.
 *
 * `skip` is a selector for chrome that sits inside the content but isn't
 * the document: code line numbers, sheet tabs, warnings.
 */
export function collectText(root: HTMLElement, skip: string): SearchText {
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const parent = node.parentElement;
			if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
			if (skip && parent.closest(skip)) return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	const slices: TextSlice[] = [];
	let text = "";
	let lastBlock: Element | null = null;
	let node = walker.nextNode() as Text | null;
	while (node) {
		const value = node.nodeValue ?? "";
		if (value.length > 0) {
			const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
			if (slices.length > 0 && block !== lastBlock) text += "\n";
			lastBlock = block;
			slices.push({ node, start: text.length, end: text.length + value.length });
			text += value;
		}
		node = walker.nextNode() as Text | null;
	}
	return { text, slices };
}

/**
 * Every place `query` occurs in `text`.
 *
 * A space in the query matches any run of whitespace, because rendered
 * documents break lines and double-space wherever their layout lands.
 * Case folding goes through the regex `i` flag rather than toLowerCase():
 * lowercasing can change a string's length ("İ" becomes two characters),
 * which would shift every offset after it.
 */
export function findMatches(text: string, query: string, options: FindOptions): TextMatch[] {
	// Trimmed so a stray leading space can't anchor a match on one of the
	// line breaks collectText inserts, which has no text node to start in.
	const trimmed = query.trim();
	if (!trimmed) return [];

	const pattern = trimmed
		.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\s+/g, "\\s+");
	const regex = new RegExp(pattern, options.matchCase ? "g" : "gi");

	const matches: TextMatch[] = [];
	let found = regex.exec(text);
	while (found && matches.length < options.limit) {
		matches.push({ start: found.index, end: found.index + found[0].length });
		found = regex.exec(text);
	}
	return matches;
}

/** Index of the slice holding `offset`. `atEnd` picks the slice a range *ends* in. */
function sliceIndex(slices: TextSlice[], offset: number, atEnd: boolean): number {
	let low = 0;
	let high = slices.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const slice = slices[mid];
		const before = atEnd ? offset <= slice.start : offset < slice.start;
		const after = atEnd ? offset > slice.end : offset >= slice.end;
		if (before) high = mid - 1;
		else if (after) low = mid + 1;
		else return mid;
	}
	return -1;
}

/** A DOM Range covering one match, or null if its ends fall in a line break we inserted. */
export function rangeFor(map: SearchText, match: TextMatch): Range | null {
	const first = sliceIndex(map.slices, match.start, false);
	const last = sliceIndex(map.slices, match.end, true);
	if (first < 0 || last < 0) return null;

	const start = map.slices[first];
	const end = map.slices[last];
	const range = start.node.ownerDocument.createRange();
	range.setStart(start.node, match.start - start.start);
	range.setEnd(end.node, match.end - end.start);
	return range;
}
