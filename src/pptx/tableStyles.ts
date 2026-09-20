import JSZip from "jszip";
import { slidePathsInOrder } from "./extract";

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

/**
 * Work out which tables have a style the file actually defines, and which do
 * not.
 *
 * PowerPoint's built-in table styles live inside PowerPoint, not in the .pptx.
 * A deck that uses one stores only its GUID in `<a:tableStyleId>`, and
 * `ppt/tableStyles.xml` carries definitions for the styles the deck has
 * customised. The `def` attribute on `<a:tblStyleLst>` is not a style applied
 * to anything: it names the style PowerPoint will give the *next* table
 * somebody creates.
 *
 * So a table with no `<a:tableStyleId>` has no style at all, and PowerPoint
 * draws it plain: no fills, no banding, a thin grid. That is exactly what
 * PowerPoint's own export of CYBR 226 week 3 slide 5 shows.
 *
 * `@jvmr/pptx-to-html` instead invents one, painting the header row #4F81BD
 * (the Office 2007 accent blue) and banding the body rows, then leaves the
 * header text black on top of it. Marking these tables lets the stylesheet put
 * them back to the plain grid the deck asked for.
 */

/** Style GUIDs the file itself defines, which may be empty. */
async function definedStyleIds(zip: JSZip): Promise<Set<string>> {
	const ids = new Set<string>();
	const file = zip.file("ppt/tableStyles.xml");
	if (!file) return ids;

	try {
		const doc = new DOMParser().parseFromString(await file.async("text"), "application/xml");
		const styles = doc.getElementsByTagNameNS(NS_A, "tblStyle");
		for (let i = 0; i < styles.length; i++) {
			const id = styles[i].getAttribute("styleId");
			if (id) ids.add(id);
		}
	} catch {
		// An unreadable part means no definitions, which is the safe answer:
		// tables then keep whatever the renderer gave them.
	}

	return ids;
}

/**
 * For every slide, one flag per table in document order: true when the file
 * defines the style the table asks for, false when it does not.
 */
export async function readTableStyleSupport(buffer: ArrayBuffer): Promise<boolean[][]> {
	try {
		const zip = await JSZip.loadAsync(buffer);
		const defined = await definedStyleIds(zip);
		const paths = await slidePathsInOrder(zip);
		const perSlide: boolean[][] = [];

		for (const path of paths) {
			const file = zip.file(path);
			if (!file) {
				perSlide.push([]);
				continue;
			}

			const doc = new DOMParser().parseFromString(await file.async("text"), "application/xml");
			const tbls = doc.getElementsByTagNameNS(NS_A, "tbl");
			const flags: boolean[] = [];

			for (let t = 0; t < tbls.length; t++) {
				const idNode = tbls[t].getElementsByTagNameNS(NS_A, "tableStyleId")[0];
				const id = idNode?.textContent?.trim();
				flags.push(Boolean(id && defined.has(id)));
			}

			perSlide.push(flags);
		}

		return perSlide;
	} catch {
		return [];
	}
}

/** Class marking a table whose style the deck never defined. */
export const UNSTYLED_TABLE_CLASS = "vault-scope-table-unstyled";

/**
 * Tag every table on this slide whose style the file does not define.
 *
 * Tables are matched positionally against the XML, the same assumption
 * applyTableMerges makes. Returns how many were tagged.
 */
export function markUnstyledTables(slide: HTMLElement, resolved: boolean[]): number {
	const tables = Array.from(slide.querySelectorAll("table"));
	let marked = 0;

	for (let t = 0; t < Math.min(tables.length, resolved.length); t++) {
		if (resolved[t]) continue;
		tables[t].classList.add(UNSTYLED_TABLE_CLASS);
		marked++;
	}

	return marked;
}
