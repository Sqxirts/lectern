import { describe, expect, it } from "vitest";
import { resolveColorIn, DEFAULT_CLR_MAP, type ColorContext } from "../src/pptx/color";

const ctx: ColorContext = {
	theme: { dk1: "#000000", lt1: "#FFFFFF", accent1: "#4472C4", accent2: "#90C226" },
	clrMap: DEFAULT_CLR_MAP,
};

function fill(inner: string): Element {
	return new DOMParser().parseFromString(
		`<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${inner}</a:solidFill>`,
		"application/xml"
	).documentElement;
}

describe("resolveColorIn", () => {
	it("reads a plain hex colour", () => {
		expect(resolveColorIn(fill('<a:srgbClr val="0c234b"/>'), ctx)).toBe("#0C234B");
	});

	it("maps tx1/bg1 through the colour map to theme slots", () => {
		expect(resolveColorIn(fill('<a:schemeClr val="tx1"/>'), ctx)).toBe("#000000");
		expect(resolveColorIn(fill('<a:schemeClr val="bg1"/>'), ctx)).toBe("#FFFFFF");
	});

	it("applies lumMod, which the renderer drops", () => {
		// bg1 at 75% luminance: the grey of the CYBR 310 Facet connectors,
		// which the renderer painted white.
		expect(resolveColorIn(fill('<a:schemeClr val="bg1"><a:lumMod val="75000"/></a:schemeClr>'), ctx)).toBe("#BFBFBF");
	});

	it("applies tint toward white", () => {
		// Medium Style 2's band colour: accent1 at 40% tint.
		const c = resolveColorIn(fill('<a:schemeClr val="accent1"><a:tint val="40000"/></a:schemeClr>'), ctx)!;
		const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
		expect(r).toBeGreaterThan(0x44);
		expect(b).toBeGreaterThan(0xc4);
		expect(Math.min(r, g, b)).toBeGreaterThan(150);
	});

	it("keeps alpha as rgba", () => {
		expect(resolveColorIn(fill('<a:schemeClr val="accent2"><a:alpha val="30000"/></a:schemeClr>'), ctx)).toBe("rgba(144, 194, 38, 0.3)");
	});

	it("resolves phClr to the colour a style reference passes down", () => {
		expect(resolveColorIn(fill('<a:schemeClr val="phClr"/>'), { ...ctx, phClr: "#123456" })).toBe("#123456");
	});
});
