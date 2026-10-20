import { fontStack } from "./fonts";
import { TAB_CLASS } from "./tabStops";
import type { ParagraphModel, RunStyle, SlideTextModel, TextBodyModel } from "./textModel";

/**
 * Rebuild the contents of the renderer's text boxes and table cells from the
 * resolved model in textModel.ts.
 *
 * The renderer's boxes stay where they are: position, size, rotation and
 * z-order are its job and it does them well enough. Only what is inside
 * changes. Everything is built with DOM calls and textContent, never markup,
 * so nothing in a deck can inject HTML.
 */

function applyRunStyle(el: HTMLElement, s: RunStyle): void {
	if (s.fontFamily) el.style.fontFamily = fontStack(s.fontFamily);
	if (s.sizePt !== undefined) el.style.fontSize = `${s.sizePt}pt`;
	if (s.bold !== undefined) el.style.fontWeight = s.bold ? "bold" : "normal";
	if (s.italic !== undefined) el.style.fontStyle = s.italic ? "italic" : "normal";
	if (s.color) el.style.color = s.color;

	const lines: string[] = [];
	if (s.underline) lines.push("underline");
	if (s.strike) lines.push("line-through");
	if (lines.length) {
		el.style.textDecorationLine = lines.join(" ");
		if (s.underline === "double") el.style.textDecorationStyle = "double";
	}

	if (s.letterSpacingPt) el.style.letterSpacing = `${s.letterSpacingPt}pt`;
	if (s.caps === "all") el.style.textTransform = "uppercase";
	if (s.caps === "small") el.style.fontVariant = "small-caps";
	if (s.highlight) el.style.backgroundColor = s.highlight;

	if (s.baseline) {
		// PowerPoint shrinks super- and subscript to about two thirds.
		el.style.verticalAlign = s.baseline > 0 ? "super" : "sub";
		el.style.fontSize = s.sizePt !== undefined ? `${+(s.sizePt * 0.66).toFixed(2)}pt` : "0.66em";
	}
}

function lineHeightCss(p: ParagraphModel): string {
	return "multiple" in p.lineHeight ? String(+p.lineHeight.multiple.toFixed(3)) : `${p.lineHeight.pt}pt`;
}

function buildParagraph(p: ParagraphModel, isFirst: boolean): HTMLElement {
	const el = document.createElement("div");
	el.className = "lectern-p";
	el.style.textAlign = p.align;
	el.style.paddingLeft = `${p.marginLeftPx}px`;
	if (p.marginRightPx) el.style.paddingRight = `${p.marginRightPx}px`;
	el.style.tabSize = `${p.tabSizePx}px`;
	// Tab stops for applyTabStops, which widens each tab box once there is
	// layout to measure. Until then tabs keep the CSS default spacing.
	el.dataset.tabDefault = String(p.tabSizePx);
	if (p.tabStopsPx.length) el.dataset.tabStops = p.tabStopsPx.map((x) => +x.toFixed(2)).join(",");
	if (p.indentPx < 0) el.dataset.tabHang = String(p.marginLeftPx);
	el.style.textIndent = `${p.indentPx}px`;
	el.style.lineHeight = lineHeightCss(p);
	// PowerPoint does not add space before the first paragraph of a box.
	if (!isFirst && p.spaceBeforePt) el.style.marginTop = `${p.spaceBeforePt}pt`;
	if (p.spaceAfterPt) el.style.marginBottom = `${p.spaceAfterPt}pt`;
	// The paragraph's own size sets every line's minimum height (the CSS
	// strut), so it must be the largest run's, as PowerPoint measures lines.
	// The inherited default is often 18pt while every run says 13.5pt, which
	// spread CYBR 226 week 5 bullets 7px apart per line.
	const textRuns = p.runs.filter((r) => r.text !== "\n");
	const sizeOf = (r: (typeof textRuns)[number]) => r.style.sizePt ?? p.baseStyle.sizePt ?? p.endSizePt;
	const lead = textRuns.reduce<(typeof textRuns)[number] | undefined>((a, r) => (!a || sizeOf(r) > sizeOf(a) ? r : a), undefined);
	el.style.fontSize = `${lead ? sizeOf(lead) : p.endSizePt}pt`;
	// The strut's font matters too: a different face has a different ascent
	// and descent, and aligning baselines across two faces grows the line past
	// an exact line height (CYBR 310 week 2: 34pt lines drew about 36pt).
	const family = lead?.style.fontFamily ?? p.baseStyle.fontFamily;
	if (family) el.style.fontFamily = fontStack(family);
	if (p.baseStyle.color) el.style.color = p.baseStyle.color;

	const hasText = p.runs.some((r) => r.text !== "\n" && r.text !== "");
	if (!hasText) {
		// An empty paragraph still takes a line at the paragraph mark's size.
		const spacer = document.createElement("span");
		spacer.style.fontSize = `${p.endSizePt}pt`;
		// Zero-width space: gives the line a height without visible text.
		spacer.textContent = "\u200B";
		el.appendChild(spacer);
		return el;
	}

	if (p.bullet) {
		const b = document.createElement("span");
		b.className = "lectern-bullet";
		b.textContent = p.bullet.text;
		b.style.display = "inline-block";
		b.style.textIndent = "0";
		// A hanging indent reserves the bullet's column; without one, a small gap.
		if (p.indentPx < 0) b.style.minWidth = `${-p.indentPx}px`;
		else b.style.paddingRight = "0.4em";
		if (p.bullet.fontFamily) b.style.fontFamily = p.bullet.fontFamily;
		if (p.bullet.color) b.style.color = p.bullet.color;
		if (p.bullet.sizePt) b.style.fontSize = `${p.bullet.sizePt}pt`;
		// An inline-block sits on its own baseline; with a smaller bullet font
		// that pushes the line box past an exact line height (a 30pt line drew
		// 36pt on CYBR 310 week 1). Zero line height keeps it out of the sum.
		b.style.lineHeight = "0";
		el.appendChild(b);
	}

	// A tab straight after a hanging bullet goes to the hanging indent, which
	// the bullet column already reaches. Rendered as a CSS tab it opened a
	// 96px gap after the bullet.
	let dropLeadingTab = Boolean(p.bullet) && p.indentPx < 0;

	for (const run of p.runs) {
		if (run.text === "\n") {
			el.appendChild(document.createElement("br"));
			continue;
		}
		const span = document.createElement("span");
		let text = run.text;
		if (dropLeadingTab && text) {
			if (text.startsWith("\t")) text = text.slice(1);
			dropLeadingTab = false;
		}
		// Each tab becomes its own box so the layout pass can size it to the
		// next stop. A literal tab character only knows the default spacing.
		text.split("\t").forEach((part, i) => {
			if (i > 0) {
				const tab = document.createElement("span");
				tab.className = TAB_CLASS;
				tab.textContent = "\t";
				span.appendChild(tab);
			}
			if (part) span.appendChild(document.createTextNode(part));
		});
		applyRunStyle(span, run.style);
		el.appendChild(span);
	}

	return el;
}

function fillBody(target: HTMLElement, body: TextBodyModel): void {
	const frag = document.createDocumentFragment();
	body.paragraphs.forEach((p, i) => frag.appendChild(buildParagraph(p, i === 0)));
	target.replaceChildren(frag);
	target.style.padding = `${body.insetsPx.top}px ${body.insetsPx.right}px ${body.insetsPx.bottom}px ${body.insetsPx.left}px`;
	target.style.whiteSpace = body.wrap ? "pre-wrap" : "pre";
	target.classList.add("lectern-text");
}

const keyOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, "");

/** The renderer's text boxes: absolutely placed, pre-wrap, holding text and no table or picture. */
function renderedTextBoxes(slide: HTMLElement): HTMLElement[] {
	return Array.from(slide.querySelectorAll<HTMLElement>("div")).filter(
		(d) =>
			d.style.position === "absolute" &&
			d.style.whiteSpace === "pre-wrap" &&
			!d.querySelector("table, img, svg") &&
			keyOf(d) !== ""
	);
}

/**
 * Rebuild text boxes, matched to the model by their text. Returns how many
 * were rebuilt. A box with no match keeps what the renderer drew.
 */
export function applyTextBoxes(slide: HTMLElement, model: SlideTextModel | undefined): number {
	if (!model) return 0;
	const pool = [...model.boxes];
	let rebuilt = 0;

	for (const box of renderedTextBoxes(slide)) {
		const key = keyOf(box);
		const i = pool.findIndex((m) => m.key === key);
		if (i < 0) continue;
		const [body] = pool.splice(i, 1);
		fillBody(box, body);
		box.style.justifyContent = justify(body);
		rebuilt++;
	}

	// Boxes the renderer never drew because it dropped their field text:
	// slide numbers and dates. Draw them in the renderer's own style of box.
	const host = slide.querySelector<HTMLElement>(".slide") ?? slide;
	for (const body of pool) {
		if (!body.hasField || !body.rectPx) continue;
		const box = document.createElement("div");
		Object.assign(box.style, {
			position: "absolute",
			left: `${body.rectPx.x}px`,
			top: `${body.rectPx.y}px`,
			width: `${body.rectPx.w}px`,
			height: `${body.rectPx.h}px`,
			boxSizing: "border-box",
			display: "flex",
			flexDirection: "column",
			justifyContent: justify(body),
			// Top of its own band: master 0-9999, layout 10000+, slide 20000+.
			zIndex: String(body.layer * 10000 + 9999),
		});
		fillBody(box, body);
		host.appendChild(box);
		rebuilt++;
	}

	return rebuilt;
}

function justify(body: TextBodyModel): string {
	return body.anchor === "middle" ? "center" : body.anchor === "bottom" ? "flex-end" : "flex-start";
}

/**
 * Rebuild table cell text. Positional, like the fills and merges, so it must
 * run before applyTableMerges and skips any table whose shape disagrees.
 */
export function applyCellText(slide: HTMLElement, model: SlideTextModel | undefined): number {
	if (!model) return 0;
	const rendered = Array.from(slide.querySelectorAll("table"));
	let rebuilt = 0;

	for (let t = 0; t < Math.min(rendered.length, model.tables.length); t++) {
		const expected = model.tables[t];
		const rows = Array.from(rendered[t].rows);
		if (rows.length !== expected.length) continue;
		if (!rows.every((row, r) => row.cells.length === expected[r].length)) continue;

		rows.forEach((row, r) => {
			Array.from(row.cells).forEach((cell, c) => {
				const body = expected[r][c];
				// Only where the text agrees, as a last guard on the position match.
				if (!body || keyOf(cell) !== body.key) return;
				fillBody(cell, body);
				cell.style.verticalAlign = body.anchor;
				rebuilt++;
			});
		});
	}

	return rebuilt;
}
