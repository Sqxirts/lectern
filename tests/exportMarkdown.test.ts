import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { docxToMarkdown, rowsToMarkdownTable } from "../src/export/docxMarkdown";
import { workbookToMarkdown } from "../src/export/xlsxMarkdown";
import { exportNoteContent, exportNotePath, isLecternExport } from "../src/export/exportNote";

function fixture(name: string): ArrayBuffer {
	const buffer = readFileSync(join(__dirname, "..", "fixtures", "out", name));
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A minimal .docx holding just this body, plus a numbering part. */
async function makeDocx(body: string): Promise<ArrayBuffer> {
	const zip = new JSZip();
	zip.file("word/document.xml", `<w:document ${W}><w:body>${body}</w:body></w:document>`);
	zip.file(
		"word/numbering.xml",
		`<w:numbering ${W}>
			<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
			<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
			<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
			<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
		</w:numbering>`,
	);
	return zip.generateAsync({ type: "arraybuffer" });
}

const para = (text: string, pPr = "", rPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe("docxToMarkdown", () => {
	it("reads the fixture's headings, paragraphs and table", async () => {
		const md = await docxToMarkdown(fixture("fixture-doc.docx"));
		expect(md).toContain("# Lectern Fixture Document");
		expect(md).toContain("## Second page");
		expect(md).toContain("| Owner | Ops |");
	});

	it("maps heading styles, emphasis and lists", async () => {
		const md = await docxToMarkdown(
			await makeDocx(
				para("Top", '<w:pStyle w:val="Heading1"/>') +
					para("Sub", '<w:pStyle w:val="Heading3"/>') +
					para("loud", "", "<w:b/>") +
					para("both", "", "<w:b/><w:i/>") +
					para("off", "", '<w:b w:val="0"/>') +
					para("apple", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') +
					para("pear", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') +
					para("first", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>') +
					para("second", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'),
			),
		);
		expect(md).toContain("# Top");
		expect(md).toContain("### Sub");
		expect(md).toContain("**loud**");
		expect(md).toContain("***both***");
		expect(md).toContain("\n\noff\n\n");
		expect(md).toContain("- apple\n- pear");
		expect(md).toContain("1. first\n2. second");
	});

	it("escapes markdown characters in plain text and skips empty paragraphs", async () => {
		const md = await docxToMarkdown(await makeDocx(para("a*b_c", "") + "<w:p/>" + para("   ", "")));
		expect(md).toBe("a\\*b\\_c");
	});

	it("rejects a zip that is not a Word document", async () => {
		const zip = new JSZip();
		zip.file("hello.txt", "hi");
		await expect(docxToMarkdown(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toThrow(/not a Word document/);
	});
});

describe("workbookToMarkdown", () => {
	it("writes one headed table per sheet", () => {
		const md = workbookToMarkdown(fixture("fixture-book.xlsx"));
		expect(md).toContain("## Controls");
		expect(md).toContain("| Control | Owner | Status |");
		expect(md).toContain("| MFA | IT | Done |");
		expect(md).toContain("## Numbers");
	});
});

describe("rowsToMarkdownTable", () => {
	it("pads short rows to the widest", () => {
		expect(rowsToMarkdownTable([["a", "b"], ["c"]])).toBe("| a | b |\n| --- | --- |\n| c |  |");
	});
	it("returns nothing for no rows", () => {
		expect(rowsToMarkdownTable([])).toBe("");
	});
});

describe("export note", () => {
	const source = { basename: "Deck", path: "Notes/Deck.pptx", parent: { path: "Notes" } } as never;

	it("names the note after its source, numbering clashes", () => {
		expect(exportNotePath(source, 1)).toBe("Notes/Deck (export).md");
		expect(exportNotePath(source, 2)).toBe("Notes/Deck (export 2).md");
		expect(exportNotePath({ basename: "A", path: "A.docx", parent: { path: "/" } } as never, 1)).toBe("A (export).md");
	});

	it("tags what it writes so it can tell its own notes from yours", () => {
		const text = exportNoteContent("Notes/Deck.pptx", "Deck", "## Slide 1\n\nHi");
		expect(isLecternExport(text)).toBe(true);
		expect(isLecternExport("---\ntags:\n  - mine\n---\n\nlectern-export")).toBe(false);
		expect(isLecternExport("# plain note")).toBe(false);
		// The frontmatter must be valid YAML with the source path intact.
		const front = text.split("---")[1];
		expect(front).toContain('source: "Notes/Deck.pptx"');
	});
});
