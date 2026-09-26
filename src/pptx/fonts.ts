/**
 * CSS font stacks for PowerPoint typefaces.
 *
 * The renderer emits `font-family: Aptos Display` and nothing else. When the
 * face is not installed, and Office's cloud fonts like Aptos Display usually
 * are not outside Office, the browser falls back to its default, which is a
 * serif. Every CYBR 226 week 5 title came out in Times for this reason.
 *
 * Each stack goes nearest metric-compatible face first, then a close system
 * face, then the right generic family, so a missing font degrades to a
 * similar shape rather than a different kind of type.
 */

const FALLBACKS: Record<string, string[]> = {
	"aptos display": ["Aptos", "Segoe UI", "Helvetica Neue", "Arial"],
	"aptos narrow": ["Aptos", "Arial Narrow", "Segoe UI"],
	"aptos": ["Segoe UI", "Helvetica Neue", "Arial"],
	"calibri light": ["Calibri", "Carlito", "Segoe UI Light", "Segoe UI"],
	"calibri": ["Carlito", "Segoe UI", "Arial"],
	"cambria": ["Caladea", "Georgia", "Times New Roman"],
	"arial": ["Liberation Sans", "Helvetica", "Helvetica Neue"],
	"helvetica": ["Helvetica Neue", "Arial", "Liberation Sans"],
	"times new roman": ["Liberation Serif", "Times"],
	"segoe ui": ["Helvetica Neue", "Arial"],
	"consolas": ["Cascadia Mono", "Menlo", "DejaVu Sans Mono", "Courier New"],
	"courier new": ["Liberation Mono", "Courier"],
	"century gothic": ["Avenir", "Futura", "Segoe UI"],
	"gill sans mt": ["Gill Sans", "Segoe UI"],
	"franklin gothic book": ["Franklin Gothic", "Arial"],
	"tw cen mt": ["Century Gothic", "Segoe UI"],
};

const MONO = /mono|consolas|courier|code/i;
// "Sans" wins over the serif words: "PT Sans Book" is not a serif.
const SANS = /sans|gothic|grotesk|aptos|calibri|segoe|arial|helvetica|verdana|tahoma/i;
const SERIF = /serif|times|georgia|garamond|cambria|book|roman|minion|palatino|baskerville|caslon/i;

function genericFor(name: string): string {
	if (MONO.test(name)) return "monospace";
	if (SANS.test(name)) return "sans-serif";
	if (SERIF.test(name)) return "serif";
	return "sans-serif";
}

/** A family name as a safe CSS token: quoted, with quotes and backslashes removed. */
function quote(name: string): string {
	return `"${name.replace(/["\\;{}<>]/g, "")}"`;
}

/** Full CSS font-family value for one PowerPoint typeface. */
export function fontStack(typeface: string): string {
	const name = typeface.trim();
	if (!name) return "sans-serif";
	const extra = FALLBACKS[name.toLowerCase()] ?? [];
	const names = [name, ...extra.filter((f) => f.toLowerCase() !== name.toLowerCase())];
	return [...names.map(quote), genericFor(name)].join(", ");
}

/**
 * Windows symbol fonts map letters to pictures. A bullet stored as "§" in
 * Wingdings is a small square, not a section sign. These are the ones decks
 * actually use for bullets.
 */
const SYMBOL_BULLETS: Record<string, Record<string, string>> = {
	wingdings: {
		"§": "▪", // small black square
		"Ø": "➢", // arrowhead
		"ü": "✔", // check mark
		"l": "●", // black circle
		"n": "■", // black square
		"q": "❑", // shadowed white square
		"v": "❖", // black diamond minus white X
		"Ÿ": "•", // bullet
		"à": "→", // right arrow
		"è": "➔", // heavy right arrow
		"ª": "✦", // four-pointed star
		"o": "□", // white square
		"w": "◆", // black diamond
	},
	"wingdings 3": {
		"u": "▶", // black right-pointing triangle (Facet theme)
		"}": "▲",
		"Ø": "►",
		"Æ": "⮞",
	},
	symbol: {
		"·": "•",
		"-": "−",
		"Þ": "⇒",
	},
};

/** A bullet character as it should actually look, given the font it names. */
export function bulletGlyph(char: string, typeface: string | undefined): { char: string; mapped: boolean } {
	const table = typeface ? SYMBOL_BULLETS[typeface.trim().toLowerCase()] : undefined;
	// Symbol fonts are addressed through U+F000-U+F0FF, where U+F0xx means
	// byte 0xxx. Fold that back to the byte so one table covers both spellings.
	const code = char.codePointAt(0) ?? 0;
	const byte = code >= 0xf000 && code <= 0xf0ff ? String.fromCharCode(code - 0xf000) : char;
	const mapped = table?.[byte];
	if (mapped) return { char: mapped, mapped: true };
	// Private-use codes from symbol fonts that we do not know: a plain bullet
	// is a better guess than a box glyph.
	if (/[\uF000-\uF0FF]/.test(char)) return { char: "\u2022", mapped: true };
	return { char, mapped: false };
}
