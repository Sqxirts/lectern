/**
 * Did this file survive being decoded as UTF-8?
 *
 * Obsidian's vault.read() always decodes UTF-8, turning any byte it cannot make
 * sense of into U+FFFD, and vault.modify() would write that replacement
 * character back as EF BF BD. Saving a file that did not decode cleanly
 * destroys it, and there is no undo.
 *
 * It matters for real extensions this plugin claims: .plist is often a binary
 * property list, and .reg, .psm1 and .psd1 are commonly UTF-16 from Windows
 * tools, which decodes as a field of NULs.
 *
 * Lives away from CodeRenderer so it can be tested without pulling in the
 * obsidian module, which has no runtime build outside the app.
 */
export function looksUndecodable(content: string): boolean {
	if (content.includes("\u0000")) return true;

	// One U+FFFD can be genuine content someone typed. A scatter of them,
	// or a short string that is mostly them, is a failed decode.
	const replacements = content.split("�").length - 1;
	if (replacements === 0) return false;
	return replacements > 2 || replacements / Math.max(content.length, 1) > 0.01;
}
