// JSZip's source build requires "readable-stream" only to offer Node stream
// output (support.nodestream), which Lectern never uses. Exporting no Readable
// makes JSZip report nodestream = false, and keeps Node's "stream" out of the
// bundle. esbuild aliases "readable-stream" here.
module.exports = {};
