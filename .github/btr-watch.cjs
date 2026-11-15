"use strict";
// Run daily by btr-watch.yml: when the latest commit of BTR's desktop edition changes or removes any of the 8 files Lanes
// keeps in vendor/btr, open an issue in this repository, once per upstream commit. DRY_RUN=1 prints the issue instead.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const UPSTREAM = "MrTangLuyao/Bilibili-thread-ripper-desktop";
const FILES = ["shared/range-core.js", "shared/cdn-resolver.js", "shared/idm-downloader.js", "shared/runtime-notices.js", "shared/notification-view.js", "src/settings.js", "src/transport.js", "src/client.js"];
const root = path.join(__dirname, "..");

const get = async (url, as, missing) => {
  const response = await fetch(url, { headers: { "User-Agent": "lanes-btr-watch", ...(process.env.GH_TOKEN && url.startsWith("https://api.") ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) } });
  if (missing && response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return as === "json" ? response.json() : response.text();
};
// missing: a file upstream removed reads as null instead of failing the run.
const upstream = (sha, file, missing) => get(`https://raw.githubusercontent.com/${UPSTREAM}/${sha}/${file}`, "text", missing);
const lf = text => text.replace(/\r\n/g, "\n"); // a Windows checkout has CRLF
const { apply } = require("../btr-patches.cjs"); // vendor/btr carries Lanes' patches; upstream's files get them too

(async () => {
  const sha = (await get(`https://api.github.com/repos/${UPSTREAM}/commits/main`, "json")).sha, short = sha.slice(0, 7);
  const changed = [], removed = [];
  for (const file of FILES) {
    const name = path.basename(file), text = await upstream(sha, file, true);
    if (text === null) removed.push(file);
    else if (lf(apply(name, text)) !== lf(fs.readFileSync(path.join(root, "vendor", "btr", name), "utf8"))) changed.push(file);
  }
  const count = changed.length + removed.length;
  if (!count) return console.log(`BTR desktop ${short}: vendor/btr matches, nothing to do`);

  const version = JSON.parse(await upstream(sha, "desktop.json")).version;
  const used = (fs.readFileSync(path.join(root, "README.md"), "utf8").match(/Bilibili-thread-ripper-desktop\/commit\/([0-9a-f]{40})/) || [])[1];
  const title = `BTR desktop ${version} (${short}) changes ${count} vendored file${count > 1 ? "s" : ""}`;
  const body = [
    `BTR's desktop edition has a new commit, [\`${short}\`](https://github.com/${UPSTREAM}/commit/${sha}) (version ${version}), that changes files Lanes runs:`,
    "",
    ...changed.map(file => `- \`${file}\``),
    ...removed.map(file => `- \`${file}\` (removed upstream)`),
    "",
    used ? `Changes since the version Lanes uses: https://github.com/${UPSTREAM}/compare/${used}...${sha}` : "",
    "",
    "To update: replace these files in `vendor/btr/`, run `node btr-patches.cjs` (drop a patch that no longer applies if BTR fixed it), bump the BTR version strings (README x3, `app/page/inject.js`), run `node build.cjs` and `node check.cjs`, and test in the real client. Close this issue once a Lanes release carries the change.",
    removed.length ? "\nFor a file removed upstream, find what replaced it, then update `vendor/btr/` and `FILES` in `.github/btr-watch.cjs` to match." : ""
  ].join("\n");
  if (process.env.DRY_RUN) return console.log(`would open: ${title}\n\n${body}`);

  const gh = args => execFileSync("gh", args, { encoding: "utf8" }).trim();
  if (Number(gh(["issue", "list", "--state", "all", "--search", `${short} in:title`, "--json", "number", "--jq", "length"])) > 0) return console.log(`An issue for ${short} exists already`);
  console.log(gh(["issue", "create", "--title", title, "--body", body]));
})().catch(error => { console.error(error); process.exit(1); });
