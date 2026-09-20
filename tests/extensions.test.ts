import { describe, expect, it } from "vitest";
import hljs from "highlight.js";
import {
	ALL_EXTENSIONS,
	CODE_EXTENSIONS,
	CODE_EXTENSION_GROUPS,
	LEGACY_EXTENSIONS_0_1_0,
	NEVER_REGISTER,
	OFFICE_EXTENSIONS,
	classify,
	migrateExtensions,
	LANGUAGE_ALIASES,
	type ExtensionPrefs,
} from "../src/constants";

const CATALOGUE = [...CODE_EXTENSIONS, ...OFFICE_EXTENSIONS];

function prefs(overrides: Partial<ExtensionPrefs> = {}): ExtensionPrefs {
	return { registeredExtensions: [...CATALOGUE], knownExtensions: [...CATALOGUE], ...overrides };
}

describe("extension catalogue", () => {
	it("lists every extension exactly once across the groups", () => {
		const flat = Object.values(CODE_EXTENSION_GROUPS).flat();
		const duplicates = flat.filter((ext, i) => flat.indexOf(ext) !== i);
		expect(duplicates).toEqual([]);
	});

	it("keeps everything 0.1.0 offered", () => {
		const missing = LEGACY_EXTENSIONS_0_1_0.filter((ext) => !ALL_EXTENSIONS.includes(ext));
		expect(missing).toEqual([]);
	});

	it("never claims an extension Obsidian owns", () => {
		const stolen = ALL_EXTENSIONS.filter((ext) => NEVER_REGISTER.has(ext));
		expect(stolen).toEqual([]);
	});

	it("classifies every code extension as code and office ones by kind", () => {
		for (const ext of CODE_EXTENSIONS) expect(classify(ext)).toBe("code");
		expect(classify("pptx")).toBe("pptx");
		expect(classify("xls")).toBe("xlsx");
		expect(classify("psd")).toBe("unsupported");
	});

	it("resolves every alias to a grammar highlight.js actually has", () => {
		const broken = Object.entries(LANGUAGE_ALIASES).filter(([, lang]) => !hljs.getLanguage(lang));
		expect(broken).toEqual([]);
	});

	it("only aliases extensions that are in the catalogue", () => {
		const orphans = Object.keys(LANGUAGE_ALIASES).filter((ext) => !CODE_EXTENSIONS.includes(ext));
		expect(orphans).toEqual([]);
	});
});

describe("migrateExtensions", () => {
	it("leaves a fresh install alone", () => {
		const { changed } = migrateExtensions(prefs(), false);
		expect(changed).toBe(false);
	});

	it("enables extensions added since the saved list was written", () => {
		const saved = prefs({
			registeredExtensions: ["py", "txt"],
			knownExtensions: ["py", "txt"],
		});

		const { prefs: next, changed } = migrateExtensions(saved, true);

		expect(changed).toBe(true);
		expect(next.registeredExtensions).toContain("yara");
		expect(next.knownExtensions).toEqual(CATALOGUE);
	});

	it("does not resurrect an extension the user turned off", () => {
		const known = CATALOGUE;
		const saved = prefs({
			registeredExtensions: known.filter((ext) => ext !== "docx"),
			knownExtensions: known,
		});

		const { prefs: next } = migrateExtensions(saved, true);

		expect(next.registeredExtensions).not.toContain("docx");
	});

	it("treats a 0.1.0 data.json with no knownExtensions as the 0.1.0 catalogue", () => {
		// The user had switched .env off back then; it must stay off, while
		// everything new since must come on.
		const saved = prefs({
			registeredExtensions: LEGACY_EXTENSIONS_0_1_0.filter((ext) => ext !== "env"),
			knownExtensions: [],
		});

		const { prefs: next, changed } = migrateExtensions(saved, true);

		expect(changed).toBe(true);
		expect(next.registeredExtensions).not.toContain("env");
		expect(next.registeredExtensions).toContain("log");
		expect(next.registeredExtensions).toContain("psm1");
	});

	it("is idempotent once migrated", () => {
		const first = migrateExtensions(prefs({ registeredExtensions: ["py"], knownExtensions: ["py"] }), true);
		const second = migrateExtensions(first.prefs, true);
		expect(second.changed).toBe(false);
	});
});
