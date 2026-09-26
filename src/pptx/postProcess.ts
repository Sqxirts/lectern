import { readTableMerges, applyTableMerges, type TableMerges } from "./tableMerges";
import { readTableStyleSupport, markUnstyledTables, readCellFills, applyCellFills, type CellFill } from "./tableStyles";
import { readSlideText, type SlideTextModel } from "./textModel";
import { applyTextBoxes, applyCellText } from "./textApply";
import { readShapeArt, applyShapeArt, type ShapeArtModel } from "./shapes";
import { readTableCellStyles, applyTableCellStyles, type StyledTable } from "./tableStyleEngine";
import { readPictureEffects, applyPictureEffects, type PictureEffect } from "./pictures";

/**
 * Everything read from the deck's XML to correct what the renderer emits.
 *
 * One shared path for the plugin and the fidelity harness, so the harness
 * measures the plugin rather than a hand-kept copy of it. A copy is how a
 * cell-fill regression reached week 5 slide 11 unnoticed.
 */
export interface SlideFixData {
	merges: TableMerges[][];
	styled: boolean[][];
	fills: CellFill[][][][];
	text: SlideTextModel[];
	shapes: ShapeArtModel[][];
	tableStyles: (StyledTable | null)[][];
	pictures: PictureEffect[][];
}

export async function readSlideFixData(buffer: ArrayBuffer): Promise<SlideFixData> {
	const [merges, styled, fills, text, shapes, tableStyles, pictures] = await Promise.all([
		readTableMerges(buffer),
		readTableStyleSupport(buffer),
		readCellFills(buffer),
		readSlideText(buffer),
		readShapeArt(buffer),
		readTableCellStyles(buffer),
		readPictureEffects(buffer),
	]);
	return { merges, styled, fills, text, shapes, tableStyles, pictures };
}

/** Apply every XML-driven fix to one rendered slide, in the order they need. */
export function fixSlide(stage: HTMLElement, data: SlideFixData, index: number): void {
	// Freeforms, transparency and adjusted presets the renderer cannot draw.
	applyShapeArt(stage, data.shapes[index]);
	// Picture transparency, greyscale and brightness.
	applyPictureEffects(stage, data.pictures[index]);
	// Text boxes: the renderer keeps one style per box; rebuild from the XML.
	applyTextBoxes(stage, data.text[index]);
	// Cell passes first: they match cells to <a:tc> 1:1, which merging breaks.
	// Table style regions, then explicit fills, then the text on top.
	applyTableCellStyles(stage, data.tableStyles[index]);
	applyCellFills(stage, data.fills[index] ?? []);
	applyCellText(stage, data.text[index]);
	// The renderer drops every rowspan and colspan, so a merged region
	// renders as its top-left cell followed by blanks.
	applyTableMerges(stage, data.merges[index] ?? []);
	// The renderer invents a blue header and banded rows for a table whose
	// style the deck never defined. PowerPoint draws those plain.
	markUnstyledTables(stage, data.styled[index] ?? []);
}
