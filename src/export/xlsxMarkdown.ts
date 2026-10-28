import * as XLSX from "xlsx";
import { rowsToMarkdownTable } from "./docxMarkdown";

/** Same caps as the preview, so an export is never bigger than what is on screen. */
const MAX_ROWS = 5000;
const MAX_COLS = 256;

/**
 * Every sheet of a workbook as a markdown pipe table under a heading.
 * Cell text is what Excel shows (SheetJS's formatted `w`), not the raw value.
 */
export function workbookToMarkdown(buffer: ArrayBuffer): string {
	const workbook = XLSX.read(new Uint8Array(buffer), { type: "array", cellStyles: false });
	const blocks: string[] = [];

	for (const name of workbook.SheetNames) {
		const sheet = workbook.Sheets[name];
		const heading = `## ${name}`;
		if (!sheet?.["!ref"]) {
			blocks.push(`${heading}\n\n_Empty sheet._`);
			continue;
		}

		const range = XLSX.utils.decode_range(sheet["!ref"]);
		const lastRow = Math.min(range.e.r, range.s.r + MAX_ROWS - 1);
		const lastCol = Math.min(range.e.c, range.s.c + MAX_COLS - 1);

		const rows: string[][] = [];
		for (let r = range.s.r; r <= lastRow; r++) {
			const cells: string[] = [];
			for (let c = range.s.c; c <= lastCol; c++) {
				const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
				const text = cell ? (cell.w ?? (cell.v != null ? String(cell.v) : "")) : "";
				cells.push(text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>"));
			}
			rows.push(cells);
		}

		const parts = [heading, rowsToMarkdownTable(rows)];
		if (range.e.r > lastRow || range.e.c > lastCol) {
			parts.push(`_Truncated to the first ${rows.length} rows and ${lastCol - range.s.c + 1} columns._`);
		}
		blocks.push(parts.join("\n\n"));
	}
	return blocks.join("\n\n");
}
