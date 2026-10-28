import JSZip from "jszip";
import { child, parseXml } from "../pptx/parts";

/**
 * Word document to markdown, read straight from the OOXML rather than from the
 * rendered preview. The preview is laid out into pages with headers, footers
 * and absolute positions; the export wants the document's own structure:
 * headings, paragraphs, lists, tables and bold or italic runs.
 *
 * Deliberately modest. Images, text boxes, footnotes, comments and tracked
 * changes are left out; the output is for searching and linking, not for
 * round-tripping back to Word.
 */

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** A w: attribute by local name, whatever prefix the file chose. */
function wAttr(el: Element | null | undefined, name: string): string | null {
	return el?.getAttributeNS(NS_W, name) ?? el?.getAttribute(`w:${name}`) ?? null;
}

/** Which list levels are bullets, keyed by numId then level. */
type ListKinds = Map<string, Map<number, "bullet" | "number">>;

export async function docxToMarkdown(buffer: ArrayBuffer): Promise<string> {
	const zip = await JSZip.loadAsync(buffer);
	const documentPart = zip.file("word/document.xml");
	if (!documentPart) throw new Error("This file has no word/document.xml, so it is not a Word document.");

	const lists = await readListKinds(zip);
	const doc = parseXml(await documentPart.async("text"));
	const body = child(doc.documentElement, "body");
	if (!body) return "";

	const blocks: string[] = [];
	const counters = new Map<string, number[]>();
	let previousWasList = false;

	for (const node of Array.from(body.children)) {
		if (node.localName === "p") {
			const line = paragraphToMarkdown(node, lists, counters);
			if (line === null) continue;
			const isList = /^\s*(?:- |\d+\. )/.test(line);
			// Items of one list sit on consecutive lines; everything else is a block.
			if (isList && previousWasList) blocks[blocks.length - 1] += `\n${line}`;
			else blocks.push(line);
			previousWasList = isList;
		} else if (node.localName === "tbl") {
			blocks.push(tableToMarkdown(node, lists, counters));
			previousWasList = false;
		}
	}
	return blocks.filter((block) => block.trim()).join("\n\n");
}

async function readListKinds(zip: JSZip): Promise<ListKinds> {
	const kinds: ListKinds = new Map();
	const part = zip.file("word/numbering.xml");
	if (!part) return kinds;

	const doc = parseXml(await part.async("text"));
	const abstractKinds = new Map<string, Map<number, "bullet" | "number">>();
	for (const abstract of Array.from(doc.getElementsByTagName("*")).filter((e) => e.localName === "abstractNum")) {
		const levels = new Map<number, "bullet" | "number">();
		for (const lvl of Array.from(abstract.children).filter((e) => e.localName === "lvl")) {
			const format = wAttr(child(lvl, "numFmt"), "val");
			levels.set(Number(wAttr(lvl, "ilvl") ?? 0), format === "bullet" ? "bullet" : "number");
		}
		abstractKinds.set(wAttr(abstract, "abstractNumId") ?? "", levels);
	}
	for (const num of Array.from(doc.getElementsByTagName("*")).filter((e) => e.localName === "num")) {
		const abstractId = wAttr(child(num, "abstractNumId"), "val") ?? "";
		const levels = abstractKinds.get(abstractId);
		if (levels) kinds.set(wAttr(num, "numId") ?? "", levels);
	}
	return kinds;
}

/** Null for a paragraph with nothing in it, so blank spacing lines don't become blocks. */
function paragraphToMarkdown(p: Element, lists: ListKinds, counters: Map<string, number[]>): string | null {
	const pPr = child(p, "pPr");
	const styleId = wAttr(child(pPr, "pStyle"), "val") ?? "";
	const text = runsToMarkdown(p).trim();
	if (!text) return null;

	const heading = /^heading\s*(\d)$/i.exec(styleId);
	if (heading) return `${"#".repeat(Math.min(Number(heading[1]), 6))} ${text}`;
	if (/^title$/i.test(styleId)) return `# ${text}`;

	const numPr = child(pPr, "numPr");
	if (numPr) {
		const numId = wAttr(child(numPr, "numId"), "val") ?? "";
		const level = Number(wAttr(child(numPr, "ilvl"), "val") ?? 0);
		// numId 0 means "no list" in OOXML.
		if (numId !== "0") {
			const indent = "  ".repeat(level);
			if (lists.get(numId)?.get(level) === "bullet") return `${indent}- ${text}`;

			const seen = counters.get(numId) ?? [];
			seen.length = level + 1;
			seen[level] = (seen[level] ?? 0) + 1;
			counters.set(numId, seen);
			return `${indent}${seen[level]}. ${text}`;
		}
	}
	return text;
}

/** Text of a paragraph, with bold and italic runs and hyperlink text kept. */
function runsToMarkdown(p: Element): string {
	let out = "";
	const walk = (node: Element): void => {
		for (const c of Array.from(node.children)) {
			if (c.localName === "r") out += runToMarkdown(c);
			else if (c.localName === "hyperlink" || c.localName === "smartTag" || c.localName === "sdt" || c.localName === "sdtContent") walk(c);
		}
	};
	walk(p);
	// Adjacent runs with the same emphasis split their markers: "**a****b**".
	return out.replace(/\*\*\*\*/g, "").replace(/(?<![*\\])\*\*(\s+)\*\*/g, "$1");
}

function runToMarkdown(r: Element): string {
	let text = "";
	for (const c of Array.from(r.children)) {
		if (c.localName === "t") text += c.textContent ?? "";
		else if (c.localName === "tab") text += "\t";
		else if (c.localName === "br" || c.localName === "cr") text += " ";
	}
	if (!text.trim()) return text;

	const rPr = child(r, "rPr");
	const on = (name: string): boolean => {
		const el = child(rPr, name);
		const val = wAttr(el, "val");
		return !!el && val !== "0" && val !== "false";
	};
	// Keep the spaces outside the markers; "** bold **" is not bold in markdown.
	const lead = /^\s*/.exec(text)?.[0] ?? "";
	const trail = /\s*$/.exec(text)?.[0] ?? "";
	let core = escapeMarkdown(text.trim());
	if (on("b") && on("i")) core = `***${core}***`;
	else if (on("b")) core = `**${core}**`;
	else if (on("i")) core = `*${core}*`;
	return `${lead}${core}${trail}`;
}

function escapeMarkdown(text: string): string {
	return text.replace(/([\\`*_[\]<>|])/g, "\\$1");
}

function tableToMarkdown(tbl: Element, lists: ListKinds, counters: Map<string, number[]>): string {
	const rows = Array.from(tbl.children)
		.filter((e) => e.localName === "tr")
		.map((tr) =>
			Array.from(tr.children)
				.filter((e) => e.localName === "tc")
				.map((tc) =>
					Array.from(tc.children)
						.filter((e) => e.localName === "p")
						.map((p) => paragraphToMarkdown(p, lists, counters) ?? "")
						.filter(Boolean)
						// A pipe or a newline would end the cell early.
						.join("<br>")
						.replace(/\|/g, "\\|"),
				),
		)
		.filter((cells) => cells.length > 0);
	return rowsToMarkdownTable(rows);
}

/** A pipe table whose first row is the header, padded to the widest row. */
export function rowsToMarkdownTable(rows: string[][]): string {
	if (rows.length === 0) return "";
	const width = Math.max(...rows.map((row) => row.length));
	const pad = (row: string[]): string[] => Array.from({ length: width }, (_, i) => row[i] ?? "");
	const line = (cells: string[]): string => `| ${cells.join(" | ")} |`;
	const [header, ...rest] = rows.map(pad);
	return [line(header), line(header.map(() => "---")), ...rest.map(line)].join("\n");
}
