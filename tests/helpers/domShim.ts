// Obsidian adds DOM helpers to the global scope and to Node/HTMLElement
// prototypes. jsdom (vitest) and the plain-Chrome harness pages in tools/ don't
// have them, so this defines the few the source uses, only where missing.
// Loaded by vitest.config.ts (setupFiles) and bundled into the tools/ checks.

interface ShimInfo {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string | number | boolean | null>;
}

const g = globalThis as unknown as Record<string, unknown>;

function shimCreateEl<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	o?: ShimInfo | string,
	callback?: (el: HTMLElementTagNameMap[K]) => void
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	const info: ShimInfo = typeof o === "string" ? { cls: o } : (o ?? {});
	if (info.cls) el.classList.add(...(Array.isArray(info.cls) ? info.cls : info.cls.split(" ").filter(Boolean)));
	if (info.text !== undefined) el.textContent = info.text;
	for (const [k, v] of Object.entries(info.attr ?? {})) {
		if (v !== null && v !== false) el.setAttribute(k, String(v));
	}
	callback?.(el);
	return el;
}

if (typeof g.createEl !== "function") g.createEl = shimCreateEl;
if (typeof g.createDiv !== "function") g.createDiv = (o?: ShimInfo | string, cb?: (el: HTMLDivElement) => void) => shimCreateEl("div", o, cb);
if (typeof g.createSpan !== "function") g.createSpan = (o?: ShimInfo | string, cb?: (el: HTMLSpanElement) => void) => shimCreateEl("span", o, cb);
if (typeof g.createFragment !== "function") {
	g.createFragment = (cb?: (f: DocumentFragment) => void) => {
		const f = document.createDocumentFragment();
		cb?.(f);
		return f;
	};
}

const nodeProto = Node.prototype as unknown as Record<string, unknown>;
if (typeof nodeProto.instanceOf !== "function") {
	nodeProto.instanceOf = function (this: Node, type: abstract new (...args: never[]) => unknown): boolean {
		return this instanceof type;
	};
}

const elProto = HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof elProto.setCssStyles !== "function") {
	elProto.setCssStyles = function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
		Object.assign(this.style, styles);
	};
}
if (typeof elProto.setCssProps !== "function") {
	elProto.setCssProps = function (this: HTMLElement, props: Record<string, string>): void {
		for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
	};
}

export {};
