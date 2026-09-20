import { describe, expect, it } from "vitest";
import { looksUndecodable } from "../src/util/text";

const NUL = String.fromCharCode(0);
const FFFD = String.fromCharCode(0xfffd);

describe("looksUndecodable", () => {
	it("passes ordinary source text", () => {
		expect(looksUndecodable("function main() {\n\treturn 1;\n}\n")).toBe(false);
	});

	it("passes text with accents and emoji, which are valid UTF-8", () => {
		expect(looksUndecodable("café — naïve — 日本語 — 🎯")).toBe(false);
	});

	it("catches a NUL, which UTF-16 content is full of", () => {
		// A UTF-16LE .reg file read as UTF-8 looks like this.
		const utf16ish = "W".concat(NUL, "i", NUL, "n", NUL, "d", NUL, "o", NUL, "w", NUL, "s", NUL);
		expect(looksUndecodable(utf16ish)).toBe(true);
	});

	it("catches a scatter of replacement characters", () => {
		expect(looksUndecodable(`bplist00${FFFD}${FFFD}${FFFD}${FFFD} garbage`)).toBe(true);
	});

	it("tolerates one or two genuine replacement characters in a long file", () => {
		const longText = "x".repeat(5000) + FFFD + "y".repeat(5000);
		expect(looksUndecodable(longText)).toBe(false);
	});

	it("treats a short string that is mostly replacements as undecodable", () => {
		expect(looksUndecodable(`${FFFD}${FFFD}${FFFD}`)).toBe(true);
	});

	it("handles an empty file without dividing by zero", () => {
		expect(looksUndecodable("")).toBe(false);
	});
});
