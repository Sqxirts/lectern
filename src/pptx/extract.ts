import JSZip from "jszip";

const NS = {
	a: "http://schemas.openxmlformats.org/drawingml/2006/main",
	p: "http://schemas.openxmlformats.org/presentationml/2006/main",
	r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
	rel: "http://schemas.openxmlformats.org/package/2006/relationships",
};

const NOTES_SLIDE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";

export interface SlideText {
	/** 1-based, in presentation order. */
	index: number;
	/** Visible text, one entry per paragraph. */
	paragraphs: string[];
	/** Speaker notes, one entry per paragraph. Empty when the slide has none. */
	notes: string[];
}

function parseXml(xml: string): Document {
	return new DOMParser().parseFromString(xml, "application/xml");
}

/** Text of one paragraph: every <a:t> run inside it, concatenated. */
function paragraphText(paragraph: Element): string {
	const runs = paragraph.getElementsByTagNameNS(NS.a, "t");
	let text = "";
	for (let i = 0; i < runs.length; i++) {
		text += runs[i].textContent ?? "";
	}
	return text.trim();
}

/** Nearest ancestor <p:sp>, or null when the paragraph is not inside a shape. */
function enclosingShape(paragraph: Element): Element | null {
	let node: Element | null = paragraph.parentElement;
	while (node) {
		if (node.namespaceURI === NS.p && node.localName === "sp") return node;
		node = node.parentElement;
	}
	return null;
}

/** The placeholder type of a shape, e.g. "title", "body", "sldNum". */
function placeholderType(shape: Element): string | null {
	const placeholders = shape.getElementsByTagNameNS(NS.p, "ph");
	return placeholders.length > 0 ? placeholders[0].getAttribute("type") : null;
}

/**
 * Every paragraph of visible text on a slide.
 *
 * Collecting <a:p> across the whole part rather than walking <p:sp> shapes
 * matters: table cells hang off a <p:graphicFrame>, not a shape, so a
 * shape-only walk silently drops every table in the deck.
 */
function paragraphsOf(root: Document, skipPlaceholders: string[] = []): string[] {
	const paragraphs = root.getElementsByTagNameNS(NS.a, "p");
	const out: string[] = [];

	for (let i = 0; i < paragraphs.length; i++) {
		const paragraph = paragraphs[i];

		if (skipPlaceholders.length > 0) {
			const shape = enclosingShape(paragraph);
			const type = shape ? placeholderType(shape) : null;
			if (type && skipPlaceholders.includes(type)) continue;
		}

		const text = paragraphText(paragraph);
		if (text) out.push(text);
	}
	return out;
}

/** Resolve a relationship target against the folder its .rels file describes. */
function resolveTarget(baseDir: string, target: string): string {
	if (target.startsWith("/")) return target.slice(1);
	const parts = `${baseDir}/${target}`.split("/");
	const stack: string[] = [];
	for (const part of parts) {
		if (part === "." || part === "") continue;
		if (part === "..") stack.pop();
		else stack.push(part);
	}
	return stack.join("/");
}

async function readRels(zip: JSZip, partPath: string): Promise<Map<string, string>> {
	const slashIndex = partPath.lastIndexOf("/");
	const dir = partPath.slice(0, slashIndex);
	const name = partPath.slice(slashIndex + 1);
	const relsPath = `${dir}/_rels/${name}.rels`;

	const map = new Map<string, string>();
	const file = zip.file(relsPath);
	if (!file) return map;

	const doc = parseXml(await file.async("text"));
	const relationships = doc.getElementsByTagNameNS(NS.rel, "Relationship");
	for (let i = 0; i < relationships.length; i++) {
		const rel = relationships[i];
		const id = rel.getAttribute("Id");
		const target = rel.getAttribute("Target");
		const type = rel.getAttribute("Type");
		if (!id || !target) continue;
		// Key by both id and type so callers can look up either way.
		map.set(id, resolveTarget(dir, target));
		if (type === NOTES_SLIDE_REL) map.set(NOTES_SLIDE_REL, resolveTarget(dir, target));
	}
	return map;
}

/**
 * Slide order comes from <p:sldIdLst> in presentation.xml, not from the
 * slideN.xml filenames. They usually agree, but reordering slides in
 * PowerPoint leaves the filenames alone, so trusting the numbers would show
 * the deck in the wrong order.
 */
async function slidePathsInOrder(zip: JSZip): Promise<string[]> {
	const presentation = zip.file("ppt/presentation.xml");
	if (presentation) {
		const doc = parseXml(await presentation.async("text"));
		const rels = await readRels(zip, "ppt/presentation.xml");
		const ids = doc.getElementsByTagNameNS(NS.p, "sldId");
		const paths: string[] = [];
		for (let i = 0; i < ids.length; i++) {
			const rid = ids[i].getAttributeNS(NS.r, "id");
			const target = rid ? rels.get(rid) : undefined;
			if (target) paths.push(target);
		}
		if (paths.length > 0) return paths;
	}

	// Fallback: numeric sort of whatever slide parts exist.
	return Object.keys(zip.files)
		.filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
		.sort((a, b) => {
			const num = (p: string) => Number(p.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
			return num(a) - num(b);
		});
}

/**
 * Pull the plain text and speaker notes out of a .pptx.
 *
 * The HTML renderer already gives selectable text on the slide itself. This
 * exists for the copy buttons, which want clean text without the layout, and
 * for speaker notes, which the renderer does not draw at all.
 */
export async function extractPptxText(buffer: ArrayBuffer): Promise<SlideText[]> {
	const zip = await JSZip.loadAsync(buffer);
	const slidePaths = await slidePathsInOrder(zip);
	const slides: SlideText[] = [];

	for (let i = 0; i < slidePaths.length; i++) {
		const path = slidePaths[i];
		const file = zip.file(path);
		if (!file) continue;

		const doc = parseXml(await file.async("text"));
		const paragraphs = paragraphsOf(doc);

		let notes: string[] = [];
		const rels = await readRels(zip, path);
		const notesPath = rels.get(NOTES_SLIDE_REL);
		if (notesPath) {
			const notesFile = zip.file(notesPath);
			if (notesFile) {
				const notesDoc = parseXml(await notesFile.async("text"));
				// A notes slide also carries a thumbnail of the slide and the slide
				// number placeholder. Skip both so only the actual notes come back.
				notes = paragraphsOf(notesDoc, ["sldNum", "sldImg"]);
			}
		}

		slides.push({ index: i + 1, paragraphs, notes });
	}

	return slides;
}

/** One slide as plain text, ready for the clipboard. */
export function slideToPlainText(slide: SlideText): string {
	return slide.paragraphs.join("\n");
}

/** The whole deck as markdown, with a heading per slide and notes kept separate. */
export function deckToMarkdown(slides: SlideText[], includeNotes: boolean): string {
	const blocks: string[] = [];
	for (const slide of slides) {
		const parts = [`## Slide ${slide.index}`];
		if (slide.paragraphs.length > 0) parts.push(slide.paragraphs.join("\n"));
		if (includeNotes && slide.notes.length > 0) {
			parts.push(`**Speaker notes**\n\n${slide.notes.join("\n")}`);
		}
		blocks.push(parts.join("\n\n"));
	}
	return blocks.join("\n\n");
}
