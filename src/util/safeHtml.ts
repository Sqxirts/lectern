/**
 * The pptx renderer hands back HTML *strings* built from a file the user did
 * not author. Assigning those to innerHTML would run anything a hostile deck
 * smuggled in, so everything goes through here first.
 *
 * Obsidian ships sanitizeHTMLToDom(), but it strips inline style attributes,
 * and the renderer positions every shape with inline styles. Stripping them
 * would leave a pile of unpositioned text. So we sanitise by hand and keep
 * style, dropping only the things that can execute.
 */

const FORBIDDEN_TAGS = new Set([
	"SCRIPT", "IFRAME", "OBJECT", "EMBED", "APPLET", "BASE", "FORM",
	"META", "LINK", "NOSCRIPT", "FRAME", "FRAMESET",
]);

/** Attributes carrying a URL that could be a javascript: payload. */
const URL_ATTRS = ["href", "src", "xlink:href", "action", "formaction", "poster"];

const SAFE_URL = /^(https?:|data:image\/|blob:|#|\/|\.{0,2}\/)/i;

function scrubElement(el: Element): void {
	for (const attr of [...el.attributes]) {
		const name = attr.name.toLowerCase();

		// Event handlers: onclick, onerror, onload, ...
		if (name.startsWith("on")) {
			el.removeAttribute(attr.name);
			continue;
		}

		if (URL_ATTRS.includes(name)) {
			const value = attr.value.trim();
			if (!SAFE_URL.test(value)) {
				el.removeAttribute(attr.name);
			}
		}
	}
}

/**
 * Parse an untrusted HTML string into a DocumentFragment safe to insert.
 * Returns a fragment so callers can append without a second parse.
 */
export function parseUntrustedHtml(html: string): DocumentFragment {
	// A detached document: nothing here is connected to the page, so images
	// don't load and scripts don't run even before we strip them.
	const doc = new DOMParser().parseFromString(html, "text/html");

	for (const el of [...doc.body.querySelectorAll("*")]) {
		if (FORBIDDEN_TAGS.has(el.tagName)) {
			el.remove();
			continue;
		}
		scrubElement(el);
	}

	const fragment = createFragment();
	for (const node of [...doc.body.childNodes]) {
		fragment.appendChild(document.importNode(node, true));
	}
	return fragment;
}

/** Replace an element's children with sanitised untrusted HTML. */
export function setUntrustedHtml(target: HTMLElement, html: string): void {
	target.empty();
	target.appendChild(parseUntrustedHtml(html));
}
