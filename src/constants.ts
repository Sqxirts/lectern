export const VIEW_TYPE_SCOPE = "vault-scope-view";

export const PLUGIN_NAME = "Vault Scope";

/** Plain-text formats we render with highlight.js and can edit in place. */
export const CODE_EXTENSIONS = [
	"txt", "sql", "java", "py", "js", "ts", "jsx", "tsx", "json", "xml",
	"yaml", "yml", "properties", "cfg", "ini", "sh", "bat", "cmd", "ps1",
	"css", "html", "htm", "rst", "tex", "php", "rb", "go", "rs", "c", "cpp",
	"h", "hpp", "cs", "swift", "kt", "scala", "groovy", "pl", "pm", "lua",
	"r", "m", "mm", "gradle", "toml", "conf", "env", "makefile", "dockerfile",
	"gitignore", "vue", "sass", "scss", "less", "styl", "coffee", "dart",
	"erl", "ex", "exs",
] as const;

/** Binary OOXML formats. Read-only, rendered by a dedicated renderer. */
export const OFFICE_EXTENSIONS = ["docx", "xlsx", "xls", "pptx"] as const;

export const ALL_EXTENSIONS: string[] = [...CODE_EXTENSIONS, ...OFFICE_EXTENSIONS];

/**
 * Obsidian claims .md itself and .canvas/.base are core view types. Registering
 * any of them would hijack normal note editing, so they are never in the lists
 * above. Kept here as a guard in case someone adds one by hand later.
 */
export const NEVER_REGISTER = new Set(["md", "canvas", "base", "pdf"]);

export type FileKind = "code" | "docx" | "xlsx" | "pptx" | "unsupported";

export function classify(extension: string): FileKind {
	const ext = extension.toLowerCase();
	if ((CODE_EXTENSIONS as readonly string[]).includes(ext)) return "code";
	if (ext === "docx") return "docx";
	if (ext === "xlsx" || ext === "xls") return "xlsx";
	if (ext === "pptx") return "pptx";
	return "unsupported";
}
