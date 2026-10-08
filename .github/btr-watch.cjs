"use strict";
// Run daily by btr-watch.yml: when the latest commit of BTR's desktop edition changes any of the 8 files Lanes keeps in
// vendor/btr, open an issue in this repository, once per upstream commit. DRY_RUN=1 prints the issue instead.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const UPSTREAM = "MrTangLuyao/Bilibili-thread-ripper-desktop";
const FILES = ["shared/range-core.js", "shared/cdn-resolver.js", "shared/idm-downloader.js", "shared/runtime-notices.js", "shared/notification-view.js", "src/settings.js", "src/transport.js", "src/client.js"];
const root = path.join(__dirname, "..");

const get = async (url, as) => {
  const response = await fetch(url, { headers: { "User-Agent": "lanes-btr-watch", ...(process.env.GH_TOKEN && url.startsWith("https://api.") ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return as === "json" ? response.json() : response.text();
};
const upstream = (sha, file) => get(`https://raw.githubusercontent.com/${UPSTREAM}/${sha}/${file}`);
const lf = text => text.replace(/\r\n/g, "\n"); // a Windows checkout has CRLF
const { apply } = require("../btr-patches.cjs"); // vendor/btr carries Lanes' patches; upstream's files get them too

(async () => {
  const sha = (await get(`https://api.github.com/repos/${UPSTREAM}/commits/main`, "json")).sha, short = sha.slice(0, 7);
  const changed = [];
  for (const file of FILES) {
    const name = path.basename(file);
    if (lf(apply(name, await upstream(sha, file))) !== lf(fs.readFileSync(path.join(root, "vendor", "btr", name), "utf8"))) changed.push(file);
  }
  if (!changed.length) return console.log(`BTR desktop ${short}: vendor/btr matches, nothing to do`);

  const version = JSON.parse(await upstream(sha, "desktop.json")).version;
  const used = (fs.readFileSync(path.join(root, "README.md"), "utf8").match(/Bilibili-thread-ripper-desktop\/commit\/([0-9a-f]{40})/) || [])[1];
  const title = `BTR desktop ${version} (${short}) changes ${changed.length} vendored file${changed.length > 1 ? "s" : ""}`;
  const body = [
    `BTR's desktop edition has a new commit, [\`${short}\`](https://github.com/${UPSTREAM}/commit/${sha}) (version ${version}), that changes files Lanes runs:`,
    "",
    ...changed.map(file => `- \`${file}\``),
    "",
    used ? `Changes since the version Lanes uses: https://github.com/${UPSTREAM}/compare/${used}...${sha}` : "",
    "",
    "To update: replace these files in `vendor/btr/`, run `node btr-patches.cjs` (drop a patch that no longer applies if BTR fixed it), bump the BTR version strings (README x3, `app/page/inject.js`), run `node build.cjs` and `node check.cjs`, and test in the real client. Close this issue once a Lanes release carries the change."
  ].join("\n");
  if (process.env.DRY_RUN) return console.log(`would open: ${title}\n\n${body}`);

  const gh = args => execFileSync("gh", args, { encoding: "utf8" }).trim();
  if (Number(gh(["issue", "list", "--state", "all", "--search", `${short} in:title`, "--json", "number", "--jq", "length"])) > 0) return console.log(`An issue for ${short} exists already`);
  console.log(gh(["issue", "create", "--title", title, "--body", body]));
})().catch(error => { console.error(error); process.exit(1); });
