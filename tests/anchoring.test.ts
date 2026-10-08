import { beforeEach, describe, expect, it } from "vitest";
import { HIGHLIGHT_CLASS, buildAnchor, clearHighlights, resolveAnchor } from "../src/comments/anchoring";
import type { PptxAnchor } from "../src/comments/types";

const NEEDLE = "the CIA triad is not a checklist";

function slideDom(): HTMLElement {
	const root = document.createElement("div");
	root.innerHTML = `
		<div data-scope-kind="pptx" data-scope-index="1">
			<p>Opening slide with other words entirely.</p>
		</div>
		<div data-scope-kind="pptx" data-scope-index="4">
			<p>Remember <span>${NEEDLE}</span>. Instead it is a way of asking three questions.</p>
		</div>
	`;
	document.body.appendChild(root);
	return root;
}

function anchor(overrides: Partial<PptxAnchor> = {}): PptxAnchor {
	return {
		kind: "pptx",
		slide: 4,
		quote: NEEDLE,
		prefix: "Remember ",
		suffix: ". Instead it is a way",
		...overrides,
	};
}

describe("resolveAnchor", () => {
	beforeEach(() => {
		document.body.empty?.();
		document.body.innerHTML = "";
	});

	it("finds the quote using its surrounding context", () => {
		const root = slideDom();
		const placement = resolveAnchor(root, anchor(), "c1");

		expect(placement.orphaned).toBe(false);
		expect(placement.elements.length).toBeGreaterThan(0);
		expect(placement.elements.map((el) => el.textContent).join("")).toBe(NEEDLE);
		expect(placement.elements[0].dataset.commentId).toBe("c1");
	});

	it("highlights the copy inside the context match, not a cleaner copy further down (regression)", () => {
		const root = document.createElement("div");
		// The first copy re-wrapped with extra whitespace; a second, exact copy later on.
		root.innerHTML = `
			<div data-scope-kind="pptx" data-scope-index="4">
				<p>Remember the CIA   triad
				is not a checklist. Instead it is a way of asking three questions.</p>
				<p>Footnote: ${NEEDLE}.</p>
			</div>`;
		document.body.appendChild(root);

		const placement = resolveAnchor(root, anchor(), "c9");
		expect(placement.orphaned).toBe(false);
		const first = placement.elements[0];
		expect(first.closest("p")?.textContent?.startsWith("Remember")).toBe(true);
	});

	it("falls back to the quote alone when the context has changed", () => {
		const root = slideDom();
		const placement = resolveAnchor(root, anchor({ prefix: "Totally different lead-in " }), "c2");

		expect(placement.orphaned).toBe(false);
		expect(placement.elements.map((el) => el.textContent).join("")).toBe(NEEDLE);
	});

	it("finds the quote on another slide when the slide number is stale", () => {
		const root = slideDom();
		// Slide 9 does not exist, so the scoped lookups both miss.
		const placement = resolveAnchor(root, anchor({ slide: 9 }), "c3");

		expect(placement.orphaned).toBe(false);
		expect(placement.elements.map((el) => el.textContent).join("")).toBe(NEEDLE);
	});

	it("reports an orphan rather than dropping the comment", () => {
		const root = slideDom();
		const placement = resolveAnchor(root, anchor({ quote: "text that is nowhere in this deck" }), "c4");

		expect(placement.orphaned).toBe(true);
		expect(placement.elements).toHaveLength(0);
	});

	it("survives whitespace being re-wrapped by the renderer", () => {
		const root = slideDom();
		const spaced = NEEDLE.replace(/ /g, "\n   ");
		const placement = resolveAnchor(root, anchor({ quote: spaced }), "c5");

		expect(placement.orphaned).toBe(false);
	});

	it("puts the DOM back exactly as it was when highlights are cleared", () => {
		const root = slideDom();
		const textBefore = root.textContent;
		const htmlBefore = root.innerHTML;

		resolveAnchor(root, anchor(), "c6");
		expect(root.querySelectorAll(`.${HIGHLIGHT_CLASS}`).length).toBeGreaterThan(0);

		clearHighlights(root);
		expect(root.querySelectorAll(`.${HIGHLIGHT_CLASS}`)).toHaveLength(0);
		expect(root.textContent).toBe(textBefore);
		expect(root.innerHTML).toBe(htmlBefore);
	});

	it("can highlight, clear and highlight again without drifting", () => {
		const root = slideDom();
		const textBefore = root.textContent;

		for (let i = 0; i < 3; i++) {
			const placement = resolveAnchor(root, anchor(), `loop${i}`);
			expect(placement.orphaned).toBe(false);
			expect(placement.elements.map((el) => el.textContent).join("")).toBe(NEEDLE);
			clearHighlights(root);
		}

		expect(root.textContent).toBe(textBefore);
	});
});

describe("buildAnchor", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("captures the quote plus context from a live selection", () => {
		const root = slideDom();
		const span = root.querySelector("span");
		expect(span).not.toBeNull();

		const range = document.createRange();
		range.selectNodeContents(span as Node);

		const built = buildAnchor(root, range) as PptxAnchor;

		expect(built).not.toBeNull();
		expect(built.kind).toBe("pptx");
		expect(built.slide).toBe(4);
		expect(built.quote).toBe(NEEDLE);
		expect(built.prefix).toContain("Remember");
		expect(built.suffix).toContain("Instead");
	});

	it("refuses a selection with no scope around it", () => {
		const loose = document.createElement("div");
		loose.textContent = "no scope attributes anywhere";
		document.body.appendChild(loose);

		const range = document.createRange();
		range.selectNodeContents(loose);

		expect(buildAnchor(loose, range)).toBeNull();
	});
});
