import * as XLSX from "xlsx";
import { Renderer } from "./Renderer";

/** Beyond this a sheet is truncated, so a stray cell at row 1,048,576 can't hang the view. */
const MAX_ROWS = 5000;
const MAX_COLS = 256;

interface MergeSpan {
	rowspan: number;
	colspan: number;
}

export class XlsxRenderer extends Renderer {
	private activeSheet = 0;
	private sheetNames: string[] = [];

	async render(): Promise<void> {
		const buffer = await this.ctx.app.vault.readBinary(this.ctx.file);
		const workbook = XLSX.read(new Uint8Array(buffer), { type: "array", cellStyles: false });

		this.sheetNames = workbook.SheetNames;
		this.ctx.container.empty();

		if (this.sheetNames.length === 0) {
			this.ctx.container.createDiv({ cls: "vault-scope-empty", text: "This workbook has no sheets." });
			return;
		}

		if (this.sheetNames.length > 1) {
			this.drawTabs();
		}

		const sheets = this.ctx.container.createDiv({ cls: "vault-scope-xlsx-sheets" });
		this.sheetNames.forEach((name, index) => {
			const sheetEl = sheets.createDiv({ cls: "vault-scope-xlsx-sheet" });
			sheetEl.dataset.sheetIndex = String(index);
			sheetEl.toggleClass("is-active", index === this.activeSheet);
			this.drawSheet(sheetEl, workbook.Sheets[name], name);
		});
	}

	private drawTabs(): void {
		const bar = this.ctx.container.createDiv({ cls: "vault-scope-xlsx-tabs" });
		this.sheetNames.forEach((name, index) => {
			const tab = bar.createDiv({ cls: "vault-scope-xlsx-tab", text: name });
			tab.toggleClass("is-active", index === this.activeSheet);
			tab.addEventListener("click", () => this.showSheet(index));
		});
	}

	private showSheet(index: number): void {
		this.activeSheet = index;
		this.ctx.container
			.querySelectorAll<HTMLElement>(".vault-scope-xlsx-tab")
			.forEach((tab, i) => tab.toggleClass("is-active", i === index));
		this.ctx.container
			.querySelectorAll<HTMLElement>(".vault-scope-xlsx-sheet")
			.forEach((sheet, i) => sheet.toggleClass("is-active", i === index));
	}

	private drawSheet(host: HTMLElement, sheet: XLSX.WorkSheet | undefined, sheetName: string): void {
		const page = host.createDiv({ cls: "vault-scope-page" });

		if (!sheet || !sheet["!ref"]) {
			page.createDiv({ cls: "vault-scope-empty", text: "This sheet is empty." });
			return;
		}

		const range = XLSX.utils.decode_range(sheet["!ref"]);
		const lastRow = Math.min(range.e.r, range.s.r + MAX_ROWS - 1);
		const lastCol = Math.min(range.e.c, range.s.c + MAX_COLS - 1);

		const { spans, covered } = this.buildMergeMap(sheet);
		const table = page.createEl("table");
		const tbody = table.createEl("tbody");

		for (let r = range.s.r; r <= lastRow; r++) {
			const tr = tbody.createEl("tr");
			for (let c = range.s.c; c <= lastCol; c++) {
				const address = XLSX.utils.encode_cell({ r, c });
				if (covered.has(address)) continue;

				const cell = sheet[address] as XLSX.CellObject | undefined;
				// `w` is SheetJS's formatted text, which is what Excel shows.
				const text = cell ? (cell.w ?? (cell.v != null ? String(cell.v) : "")) : "";

				const td = tr.createEl("td", { text });
				td.dataset.scopeKind = "xlsx";
				td.dataset.scopeIndex = sheetName;
				td.dataset.cell = address;

				const span = spans.get(address);
				if (span) {
					if (span.rowspan > 1) td.rowSpan = span.rowspan;
					if (span.colspan > 1) td.colSpan = span.colspan;
				}
			}
		}

		if (range.e.r > lastRow || range.e.c > lastCol) {
			page.createDiv({
				cls: "vault-scope-truncated",
				text: `Showing the first ${lastRow - range.s.r + 1} rows and ${lastCol - range.s.c + 1} columns of this sheet.`,
			});
		}
	}

	/**
	 * Merged ranges arrive as a separate list. Turn them into a rowspan/colspan
	 * for the top-left cell, plus a set of addresses to skip because the merge
	 * already covers them.
	 */
	private buildMergeMap(sheet: XLSX.WorkSheet): { spans: Map<string, MergeSpan>; covered: Set<string> } {
		const spans = new Map<string, MergeSpan>();
		const covered = new Set<string>();

		for (const merge of sheet["!merges"] ?? []) {
			const anchor = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
			spans.set(anchor, {
				rowspan: merge.e.r - merge.s.r + 1,
				colspan: merge.e.c - merge.s.c + 1,
			});
			for (let r = merge.s.r; r <= merge.e.r; r++) {
				for (let c = merge.s.c; c <= merge.e.c; c++) {
					const address = XLSX.utils.encode_cell({ r, c });
					if (address !== anchor) covered.add(address);
				}
			}
		}

		return { spans, covered };
	}

	wrapperClass(): string | null {
		return "vault-scope-xlsx-active";
	}
}
