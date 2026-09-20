export const VIEW_TYPE_SCOPE = "vault-scope-view";

export const PLUGIN_NAME = "Vault Scope";

/**
 * Plain-text formats we render with highlight.js and can edit in place, grouped
 * the way the settings tab shows them. The flat list below is derived from this,
 * so adding an extension here is the only edit needed: it reaches the settings
 * grid, the registration loop and `classify()` at once.
 *
 * An extension with no highlight.js grammar is still worth listing. It falls
 * back to plaintext and the reader still gets line numbers, zoom, search and
 * comments, which is the whole point for things like Suricata rules.
 */
export const CODE_EXTENSION_GROUPS: Record<string, readonly string[]> = {
	"Shell and scripting": [
		"sh", "bash", "zsh", "fish", "bat", "cmd", "ps1", "psm1", "psd1",
		"awk", "tcl", "vbs",
	],
	"Programming languages": [
		"py", "rb", "pl", "pm", "lua", "r", "jl", "php", "dart", "coffee",
		"js", "ts", "jsx", "tsx", "java", "kt", "scala", "groovy", "cs", "vb",
		"fs", "fsx", "c", "cpp", "h", "hpp", "swift", "m", "mm", "go", "rs",
		"d", "nim", "cr", "zig", "pas", "v", "sv", "vhdl", "f90",
		"asm", "s", "nasm", "sql",
		"hs", "ml", "mli", "clj", "cljs", "edn", "el", "lisp", "scm", "rkt",
		"elm", "erl", "ex", "exs",
	],
	"Web and markup": [
		"html", "htm", "xml", "css", "sass", "scss", "less", "styl", "vue",
		"hbs", "twig", "rst", "tex", "adoc",
	],
	"Data and config": [
		"json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf",
		"properties", "env", "editorconfig", "gitignore", "plist",
		"csproj", "vbproj", "props", "targets", "sln",
	],
	"Security and forensics": [
		"log", "rules", "yar", "yara", "reg", "inf", "hta", "diff", "patch",
	],
	"Infrastructure": [
		"dockerfile", "makefile", "mk", "cmake", "gradle", "proto", "graphql",
		"gql", "http", "tf", "tfvars", "hcl", "nix",
		"service", "timer", "socket", "mount",
	],
	"Text and transcripts": ["txt", "srt", "vtt"],
};

/** Every code/text extension, flattened. Duplicates across groups are dropped. */
export const CODE_EXTENSIONS: readonly string[] = [
	...new Set(Object.values(CODE_EXTENSION_GROUPS).flat()),
];

/** Binary OOXML formats. Read-only, rendered by a dedicated renderer. */
export const OFFICE_EXTENSIONS = ["docx", "xlsx", "xls", "pptx"] as const;

export const ALL_EXTENSIONS: string[] = [...CODE_EXTENSIONS, ...OFFICE_EXTENSIONS];

/**
 * The catalogue as it shipped in 0.1.0, before extensions were grouped. Used
 * once, to migrate a `data.json` written by that version: anything outside this
 * list is genuinely new to that vault and gets switched on, while anything
 * inside it that is missing from `registeredExtensions` was turned off on
 * purpose and stays off. Never edit this; it is a record of the past.
 */
export const LEGACY_EXTENSIONS_0_1_0: readonly string[] = [
	"txt", "sql", "java", "py", "js", "ts", "jsx", "tsx", "json", "xml",
	"yaml", "yml", "properties", "cfg", "ini", "sh", "bat", "cmd", "ps1",
	"css", "html", "htm", "rst", "tex", "php", "rb", "go", "rs", "c", "cpp",
	"h", "hpp", "cs", "swift", "kt", "scala", "groovy", "pl", "pm", "lua",
	"r", "m", "mm", "gradle", "toml", "conf", "env", "makefile", "dockerfile",
	"gitignore", "vue", "sass", "scss", "less", "styl", "coffee", "dart",
	"erl", "ex", "exs", "docx", "xlsx", "xls", "pptx",
];

/**
 * Obsidian claims .md itself and .canvas/.base are core view types. Registering
 * any of them would hijack normal note editing, so they are never in the lists
 * above. Kept here as a guard in case someone adds one by hand later.
 */
export const NEVER_REGISTER = new Set(["md", "canvas", "base", "pdf"]);

/** The slice of settings the migration below touches. */
export interface ExtensionPrefs {
	registeredExtensions: string[];
	knownExtensions: string[];
}

/**
 * Fold a saved `data.json` into the current catalogue.
 *
 * `Object.assign` replaces arrays wholesale, so without this an extension added
 * in a later version is registered in code but never enabled: the saved list
 * simply does not mention it. Reports whether anything moved, so the caller
 * only writes to disk when it has to.
 */
export function migrateExtensions<T extends ExtensionPrefs>(prefs: T, hadSavedData: boolean): { prefs: T; changed: boolean } {
	if (!hadSavedData) return { prefs, changed: false };

	// A 0.1.0 data.json has no knownExtensions field. What that version offered
	// is recorded above, so use it rather than assuming the user saw everything.
	const known = new Set(
		Array.isArray(prefs.knownExtensions) && prefs.knownExtensions.length > 0
			? prefs.knownExtensions
			: LEGACY_EXTENSIONS_0_1_0
	);

	const added = ALL_EXTENSIONS.filter((ext) => !known.has(ext));
	if (added.length === 0 && prefs.knownExtensions?.length === ALL_EXTENSIONS.length) {
		return { prefs, changed: false };
	}

	const registered = new Set(prefs.registeredExtensions);
	for (const ext of added) registered.add(ext);

	prefs.registeredExtensions = ALL_EXTENSIONS.filter((ext) => registered.has(ext));
	prefs.knownExtensions = [...ALL_EXTENSIONS];
	return { prefs, changed: true };
}

/**
 * Extensions whose highlight.js language name differs from the extension.
 * Lives here rather than in the renderer so the catalogue and the grammar it
 * maps to are edited together; a test asserts both directions still line up.
 */
export const LANGUAGE_ALIASES: Record<string, string> = {
	h: "c",
	hpp: "cpp",
	mm: "objectivec",
	m: "objectivec",
	pm: "perl",
	pl: "perl",
	ps1: "powershell",
	cmd: "dos",
	bat: "dos",
	env: "bash",
	conf: "ini",
	cfg: "ini",
	properties: "ini",
	gitignore: "bash",
	makefile: "makefile",
	dockerfile: "dockerfile",
	styl: "stylus",
	ex: "elixir",
	exs: "elixir",
	erl: "erlang",
	vue: "xml",
	htm: "xml",
	html: "xml",
	tsx: "typescript",
	jsx: "javascript",
	txt: "plaintext",
	rst: "plaintext",

	// Shell. fish is not bash, but the comment/string/flag shapes line up far
	// better than plaintext does.
	zsh: "bash",
	fish: "bash",
	psm1: "powershell",
	psd1: "powershell",

	// INI under another name: systemd units, Windows registry exports and
	// driver .inf files are all key=value under [sections].
	reg: "ini",
	inf: "ini",
	editorconfig: "ini",
	service: "ini",
	timer: "ini",
	socket: "ini",
	mount: "ini",

	// XML under another name.
	hta: "xml",
	csproj: "xml",
	vbproj: "xml",
	props: "xml",
	targets: "xml",

	// Assembly. highlight.js has no generic "asm"; x86 is the right default
	// for coursework and malware analysis.
	asm: "x86asm",
	nasm: "x86asm",
	s: "x86asm",

	jl: "julia",
	el: "lisp",
	rkt: "scheme",
	mli: "ml",
	fsx: "fs",
	cljs: "clojure",
	edn: "clojure",
	gql: "graphql",

	// YARA is close enough to C for strings, comments and the condition block
	// to colour usefully. Not exact: the rule/meta/strings keywords stay plain.
	yar: "c",
	yara: "c",

	// Web server and application logs. accesslog colours timestamps, status
	// codes and quoted requests.
	log: "accesslog",

	// No grammar exists for these, so say so explicitly rather than letting
	// highlightAuto guess wrong on a short file.
	rules: "plaintext",
	tf: "plaintext",
	tfvars: "plaintext",
	hcl: "plaintext",
	zig: "plaintext",
	sln: "plaintext",
	srt: "plaintext",
	vtt: "plaintext",
};

export type FileKind = "code" | "docx" | "xlsx" | "pptx" | "unsupported";

export function classify(extension: string): FileKind {
	const ext = extension.toLowerCase();
	if (CODE_EXTENSIONS.includes(ext)) return "code";
	if (ext === "docx") return "docx";
	if (ext === "xlsx" || ext === "xls") return "xlsx";
	if (ext === "pptx") return "pptx";
	return "unsupported";
}
