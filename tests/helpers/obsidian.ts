// Test-only stand-in for the "obsidian" package, which ships types and no
// runtime. Aliased in vitest.config.ts. Covers only what the tested code uses.

export class TAbstractFile {
	constructor(public path: string) {}
}

export class TFile extends TAbstractFile {
	get name(): string {
		return this.path.split("/").pop()!;
	}
}

export class TFolder extends TAbstractFile {}

export function normalizePath(p: string): string {
	return p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export type App = unknown;
