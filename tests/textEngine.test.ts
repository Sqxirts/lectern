import { describe, expect, it } from "vitest";
import { readSlideText } from "../src/pptx/textModel";
import { applyTextBoxes, applyCellText } from "../src/pptx/textApply";
import { nextStop } from "../src/pptx/tabStops";
import { buildDeck, slide, textBox } from "./helpers/deck";

const run = (text: string, rPr = "") => `<a:r><a:rPr lang="en-US"${rPr}/><a:t>${text}</a:t></a:r>`;

/** The renderer's box for some text: absolutely placed, pre-wrap, one style. */
function rendered(text: string): HTMLElement {
	const host = document.createElement("div");
	const box = document.createElement("div");
	box.style.position = "absolute";
	box.style.whiteSpace = "pre-wrap";
	box.style.fontWeight = "bold";
	box.textContent = text;
	host.appendChild(box);
	return host;
}

describe("readSlideText", () => {
	it("keeps each run's own formatting instead of one style per box", async () => {
		// The renderer took the *last* run's style for the whole box, so one
		// green bold run turned a CYBR 310 paragraph green and bold.
		const buffer = await buildDeck({
			slides: [
				slide(
					textBox(
						2,
						`<a:p><a:r><a:rPr sz="1800"/><a:t>plain </a:t></a:r><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill></a:rPr><a:t>loud</a:t></a:r></a:p>`
					)
				),
			],
		});
		const [model] = await readSlideText(buffer);
		const [p] = model.boxes[0].paragraphs;
		expect(p.runs[0].style.bold).toBe(false);
		expect(p.runs[0].style.color).toBe("#000000");
		expect(p.runs[1].style.bold).toBe(true);
		expect(p.runs[1].style.color).toBe("#00AA00");
	});

	it("inherits title font and colour from the master's titleStyle", async () => {
		const buffer = await buildDeck({
			txStyles: `<p:titleStyle><a:lvl1pPr><a:defRPr sz="4000"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>`,
			slides: [slide(textBox(2, `<a:p>${run("Title")}</a:p>`, '<p:ph type="title"/>'))],
		});
		const [model] = await readSlideText(buffer);
		const style = model.boxes[0].paragraphs[0].runs[0].style;
		expect(style.sizePt).toBe(40);
		expect(style.color).toBe("#90C226");
		expect(style.fontFamily).toBe("Trebuchet MS");
	});

	it("uses PowerPoint's default insets when the body sets none", async () => {
		const buffer = await buildDeck({ slides: [slide(textBox(2, `<a:p>${run("x")}</a:p>`))] });
		const [model] = await readSlideText(buffer);
		expect(model.boxes[0].insetsPx).toEqual({ left: 9.6, top: 4.8, right: 9.6, bottom: 4.8 });
	});

	it("reads bullets, numbering and spacing from the paragraph chain", async () => {
		const buffer = await buildDeck({
			slides: [
				slide(
					textBox(
						2,
						`<a:p><a:pPr marL="342900" indent="-342900"><a:spcAft><a:spcPts val="800"/></a:spcAft><a:buFont typeface="Wingdings 3"/><a:buChar char="u"/></a:pPr>${run("one")}</a:p>` +
							`<a:p><a:pPr><a:buAutoNum type="alphaLcParenR"/></a:pPr>${run("two")}</a:p>` +
							`<a:p><a:pPr><a:buAutoNum type="alphaLcParenR"/></a:pPr>${run("three")}</a:p>` +
							`<a:p><a:pPr><a:buChar char="•"/></a:pPr><a:endParaRPr/></a:p>`
					)
				),
			],
		});
		const [model] = await readSlideText(buffer);
		const [a, b, c, empty] = model.boxes[0].paragraphs;
		expect(a.bullet?.text).toBe("▶");
		expect(a.indentPx).toBe(-36);
		expect(a.spaceAfterPt).toBe(8);
		expect(b.bullet?.text).toBe("a)");
		expect(c.bullet?.text).toBe("b)");
		// PowerPoint draws no bullet on an empty paragraph.
		expect(empty.bullet).toBeUndefined();
	});

	it("shows the real slide number in a slide-number field", async () => {
		const field = `<a:p><a:fld id="{1}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld></a:p>`;
		const buffer = await buildDeck({ slides: [slide(""), slide(textBox(5, field))] });
		const models = await readSlideText(buffer);
		const box = models[1].boxes[0];
		expect(box.hasField).toBe(true);
		expect(box.key).toBe("");
		expect(box.paragraphs[0].runs[0].text).toBe("2");
	});
});

describe("applyTextBoxes", () => {
	it("rebuilds a matched box with explicit weights, not the renderer's bold", async () => {
		const buffer = await buildDeck({ slides: [slide(textBox(2, `<a:p>${run("Hello world")}</a:p>`))] });
		const [model] = await readSlideText(buffer);
		const host = rendered("Hello world");
		expect(applyTextBoxes(host, model)).toBe(1);
		const span = host.querySelector(".lectern-p span") as HTMLElement;
		expect(span.textContent).toBe("Hello world");
		expect(span.style.fontWeight).toBe("normal");
	});

	it("draws a slide-number box the renderer dropped", async () => {
		const field = `<a:p><a:fld id="{1}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld></a:p>`;
		const buffer = await buildDeck({ slides: [slide(textBox(5, field))] });
		const [model] = await readSlideText(buffer);
		const host = document.createElement("div");
		expect(applyTextBoxes(host, model)).toBe(1);
		expect(host.textContent).toBe("1");
	});

	it("leaves a box alone when no model matches its text", async () => {
		const buffer = await buildDeck({ slides: [slide(textBox(2, `<a:p>${run("one")}</a:p>`))] });
		const [model] = await readSlideText(buffer);
		const host = rendered("something else");
		expect(applyTextBoxes(host, model)).toBe(0);
		expect(host.textContent).toBe("something else");
	});
});

describe("applyCellText", () => {
	it("keeps explicit bold and leaves colour to the table style", async () => {
		const tbl = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="100"/></a:tblGrid><a:tr h="10"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr b="1"/><a:t>Feature</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
		const buffer = await buildDeck({ slides: [slide(tbl)] });
		const [model] = await readSlideText(buffer);
		const host = document.createElement("div");
		host.innerHTML = "<table><tbody><tr><td>Feature</td></tr></tbody></table>";
		expect(applyCellText(host, model)).toBe(1);
		const span = host.querySelector("td span") as HTMLElement;
		expect(span.style.fontWeight).toBe("bold");
		expect(span.style.color).toBe("");
	});
});

describe("tab stops", () => {
	it("reads a paragraph's custom tab stops in px, ascending", async () => {
		// CYBR 310 week 2 slide 24 places words with stops like these.
		const p = `<a:p><a:pPr><a:tabLst><a:tab pos="1000125" algn="l"/><a:tab pos="285750" algn="l"/></a:tabLst></a:pPr>${run("The\tasterisk")}</a:p>`;
		const [model] = await readSlideText(await buildDeck({ slides: [slide(textBox(2, p))] }));
		expect(model.boxes[0].paragraphs[0].tabStopsPx).toEqual([30, 105]);
	});

	it("renders each tab as its own box for the layout pass", async () => {
		const p = `<a:p><a:pPr><a:tabLst><a:tab pos="285750"/></a:tabLst></a:pPr>${run("a\tb\tc")}</a:p>`;
		const [model] = await readSlideText(await buildDeck({ slides: [slide(textBox(2, p))] }));
		const host = rendered("abc");
		applyTextBoxes(host, model);
		expect(host.querySelectorAll(".lectern-tab")).toHaveLength(2);
		expect((host.querySelector(".lectern-p") as HTMLElement).dataset.tabStops).toBe("30");
	});
});

describe("nextStop", () => {
	it("goes to the next custom stop, then to default stops", () => {
		expect(nextStop(10, [30, 105], null, 48)).toBe(30);
		expect(nextStop(30, [30, 105], null, 48)).toBe(105);
		// Past every custom stop: the next multiple of the default spacing.
		expect(nextStop(110, [30, 105], null, 48)).toBe(144);
	});

	it("treats a hanging indent as a stop", () => {
		expect(nextStop(12, [], 46, 96)).toBe(46);
	});
});
