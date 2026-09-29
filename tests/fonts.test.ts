import { describe, expect, it } from "vitest";
import { bulletGlyph, fontStack } from "../src/pptx/fonts";

describe("fontStack", () => {
	it("gives Aptos Display a sans fallback, not the browser's serif", () => {
		// CYBR 226 week 5 titles rendered in Times without this.
		const stack = fontStack("Aptos Display");
		expect(stack.startsWith('"Aptos Display", "Aptos"')).toBe(true);
		expect(stack.endsWith("sans-serif")).toBe(true);
	});

	it("keeps serif faces serif and code faces monospace", () => {
		expect(fontStack("Times New Roman").endsWith(", serif")).toBe(true);
		expect(fontStack("Consolas").endsWith("monospace")).toBe(true);
	});

	it("strips characters that could break out of the CSS value", () => {
		expect(fontStack('Evil"; color: red')).not.toContain(";");
	});
});

describe("bulletGlyph", () => {
	it("maps the Facet theme's Wingdings 3 bullet to a triangle", () => {
		expect(bulletGlyph("\uF075", "Wingdings 3").char).toBe("▶");
	});

	it("maps Wingdings through either spelling of the same byte", () => {
		expect(bulletGlyph("§", "Wingdings").char).toBe("▪");
		expect(bulletGlyph("\uF0A7", "Wingdings").char).toBe("▪");
	});

	it("leaves ordinary characters alone", () => {
		expect(bulletGlyph("•", "Arial")).toEqual({ char: "•", mapped: false });
	});
});
