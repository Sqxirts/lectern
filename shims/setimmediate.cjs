// JSZip requires the "setimmediate" polyfill for a global setImmediate.
// Electron's renderer already has one; this covers anything that does not,
// without the original polyfill's <script> and new Function() fallbacks, which
// the community directory scan flags. esbuild aliases "setimmediate" here.
if (typeof globalThis.setImmediate !== "function") {
	globalThis.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
}
