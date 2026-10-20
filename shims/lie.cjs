// JSZip falls back to the "lie" Promise polyfill when there is no native
// Promise. Obsidian always has one, and lie pulls in "immediate", whose old-IE
// branch injects <script> elements, which the community directory scan flags.
// esbuild aliases "lie" to this file (esbuild.config.mjs).
module.exports = Promise;
