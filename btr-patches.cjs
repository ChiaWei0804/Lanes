"use strict";
// Lanes' fixes to BTR's code in vendor/btr, kept until BTR makes them itself. Each one replaces an exact span of
// upstream's file. After vendor/btr is replaced with upstream's files, `node btr-patches.cjs` applies them again;
// check.cjs fails while one is missing, and .github/btr-watch.cjs applies them to upstream's files before comparing.
// When upstream changes a span (or fixes the problem), its patch stops applying: drop it or rewrite it.
const PATCHES = [
  {
    file: "client.js",
    why: "A seek to a position already buffered is not a new start: the controller's own rule (idm-downloader.js, above AUTO_LADDER) is a new video or a seek outside the buffer. Without this, every such seek raised Auto to 16 threads again.",
    upstream: `    on("seeking", () => { started = false; newSession(); });\n`,
    patched: `    on("seeking", () => {
      // Lanes patch (btr-patches.cjs): a seek inside the buffer is not a new start; playback goes on reporting.
      const ranges = element.buffered, at = element.currentTime;
      for (let i = 0; i < ranges.length; i++) if (ranges.start(i) <= at && at < ranges.end(i)) return;
      started = false; newSession();
    });\n`
  },
  {
    file: "idm-downloader.js",
    why: "A start whose half minute ran out with no buffer report since (the video was not playing) is over, as buffer() would have ended it. Without this, the next session stepped back to the level from before that start instead of staying.",
    upstream: `      newSession() {\n        const at = now();\n`,
    patched: `      newSession() {\n        const at = now();\n        // Lanes patch (btr-patches.cjs): a start past its half minute is over even if no buffer report came since.\n        if (state.startup && at >= state.startup.until) state.startup = null;\n`
  }
];

const lf = text => text.replace(/\r\n/g, "\n");
const count = (text, part) => lf(text).split(part).length - 1;
// A file's text with its patches applied; a patch whose upstream span is not there exactly once is left out.
const apply = (file, text) => PATCHES.reduce((out, p) => p.file === file && count(out, p.upstream) === 1 ? lf(out).replace(p.upstream, () => p.patched) : out, text);
module.exports = { PATCHES, apply, count };

if (require.main === module) {
  const fs = require("fs"), path = require("path");
  let failed = false;
  for (const p of PATCHES) {
    const target = path.join(__dirname, "vendor", "btr", p.file), text = fs.readFileSync(target, "utf8");
    if (count(text, p.patched) === 1) { console.log(`${p.file}: applied already`); continue; }
    if (count(text, p.upstream) !== 1) { console.log(`${p.file}: upstream's code changed here; drop or rewrite this patch`); failed = true; continue; }
    fs.writeFileSync(target, lf(text).replace(p.upstream, () => p.patched));
    console.log(`${p.file}: applied`);
  }
  process.exit(failed ? 1 : 0);
}
