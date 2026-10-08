// Live check before a release, against the real Bilibili client that Lanes is connected to (debugging port 39229),
// with the thread count on Auto. Opens a video in a new player window (muted) and checks: Lanes' bundle is in it,
// the video plays and is accelerated, a new video starts with more threads and steps back, a seek inside the
// buffer keeps the count, a seek outside it starts with at least 16 again. Run: node tools/live-check.mjs
const PORT = 39229, AID = 117280474138641; // any public video
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (ok, what, detail) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`); };
const finish = () => { console.log(results.length && results.every(Boolean) ? "\nall passed" : "\nsome checks failed"); process.exit(results.length && results.every(Boolean) ? 0 : 1); };
const isPlayer = t => t.type === "page" && t.url.includes("player.html");

// The client keeps one player window; close whatever is open so the one found next is the new one.
for (const t of (await list()).filter(isPlayer)) await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
await sleep(1500);
const index = (await list()).find(t => t.url.includes("index.html"));
if (!index) { check(false, "the client's main window is there", "open Bilibili's main window and run again"); finish(); }
const main = new WebSocket(index.webSocketDebuggerUrl); await new Promise(r => main.onopen = r);
main.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `biliBridgePc.callNative("window/openPlayerWindow", { type: "ugc", aid: ${AID} })` } }));
let player; const opened = Date.now();
while (!player && Date.now() - opened < 15000) { player = (await list()).find(isPlayer); if (!player) await sleep(50); }
if (!player) { check(false, "a new player window opens"); finish(); }

const ws = new WebSocket(player.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0, closed = false; const waits = new Map();
ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (waits.has(m.id)) { waits.get(m.id)(m.result); waits.delete(m.id); } };
ws.onclose = () => { closed = true; for (const done of waits.values()) done(undefined); waits.clear(); };
// One evaluation in the player page; undefined when the page does not answer within 5 s or is gone.
const ev = expression => closed ? Promise.resolve(undefined) : new Promise(r => {
  const n = ++id; waits.set(n, r);
  setTimeout(() => { if (waits.delete(n)) r(undefined); }, 5000);
  ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
}).then(r => r?.result?.value);
const state = () => ev(`(() => {
  const api = globalThis.__BTR_DESKTOP__, auto = globalThis.__BILI_IDM_DOWNLOADER_FACTORY__?.autoConcurrency, v = document.querySelector("video");
  if (!api || !auto || !v) return null;
  v.muted = true;
  let ahead = 0, end = 0;
  for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.1 && v.buffered.end(i) > v.currentTime) { ahead = v.buffered.end(i) - v.currentTime; end = v.buffered.end(i); }
  const s = auto.status(), t = api.getStatus().transport;
  return { release: globalThis.__BTR_DESKTOP_RELEASE__?.version, auto: api.getSettings().autoConcurrency, threads: s.threads, startup: !!s.startup, base: s.startup?.base, time: v.currentTime, duration: v.duration, ahead, end, ranges: Array.from({ length: v.buffered.length }, (_, i) => [v.buffered.start(i), v.buffered.end(i)]), playing: !v.paused && v.readyState > 2, accelerated: t.acceleratedRequests };
})()`);
// The state once the page has it (the <video> element can be gone for a moment while the player loads); a page that
// never has it again fails the run.
const settled = async (what, ms = 10000) => {
  const until = Date.now() + ms; let s;
  while (!(s = await state()) && Date.now() < until && !closed) await sleep(200);
  if (!s) { check(false, what, closed ? "the player window closed" : "no <video> in the player window"); finish(); }
  return s;
};

let s = await settled("Lanes' bundle is in the new player window", 20000);
check(/\+lanes-/.test(s.release || ""), "Lanes' bundle is in the new player window", s.release);
if (!s.auto) { console.log("Set the thread count to Auto in Lanes and run again."); process.exit(1); }
await ev(`(() => { const v = document.querySelector("video"); v.muted = true; v.play(); return 0; })()`);
// The start: BTR keeps a start (status().startup) only while it runs above the page's level, so seeing one means the
// count was raised; the highest count seen during it, the page's level it is to step back to, and whether the count
// climbed further (not keeping up), which ends the start at that level.
let startSeen = !!s.startup, startPeak = s.startup ? s.threads : 0, base = s.base || 0, climbed = false, last = s.threads;
const start = Date.now();
while (Date.now() - start < 60000) {
  const now = await state();
  if (now) {
    s = now;
    if (s.threads > last && last >= 16) climbed = true;
    last = s.threads;
    if (s.startup) { startSeen = true; startPeak = Math.max(startPeak, s.threads); }
    base = s.base || base;
    if (s.playing && !s.startup && s.ahead >= 25) break;
  }
  await sleep(300);
}
check(s.playing, "the video plays");
check(s.accelerated > 0, "the video is accelerated", `${s.accelerated} pieces`);
check(startSeen, "a new video starts with more threads", `up to ${startPeak || "?"}, from ${base || "?"}`);
if (climbed) check(!s.startup, "the start ends where it climbed", `now ${s.threads}`);
else check(!s.startup && base > 0 && s.threads === base, "the start steps back once the buffer is ahead", `${s.threads} threads (page level ${base || "?"}), ${Math.round(s.ahead)} s ahead`);

const before = s;
await ev(`(() => { const v = document.querySelector("video"); v.currentTime = v.currentTime + 5; return 0; })()`);
await sleep(300); const inside1 = await settled("the player keeps its video after a seek");
await sleep(1700); const inside2 = await settled("the player keeps its video after a seek");
check(inside1.time >= before.time + 4, "the seek inside the buffer happened", `${Math.round(before.time)} -> ${Math.round(inside1.time)} s`);
check(inside1.threads === before.threads && !inside1.startup && inside2.threads === before.threads && !inside2.startup, "a seek inside the buffer keeps the thread count", `${before.threads} -> ${inside1.threads} -> ${inside2.threads}`);

// The middle of the longest stretch not buffered yet (at least 30 s, away from the end), so the seek really leaves
// the buffer. The client may have buffered nearly all of a short video already: then there is nothing to test.
const gaps = [], edges = [0, ...inside2.ranges.flat(), inside2.duration - 10];
for (let i = 0; i + 1 < edges.length; i += 2) if (edges[i + 1] - edges[i] >= 30) gaps.push(edges.slice(i, i + 2));
const gap = gaps.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
if (!gap) console.log("SKIP  a seek outside the buffer starts with at least 16 threads  (the video is buffered almost to the end)");
else {
  const target = (gap[0] + gap[1]) / 2;
  await ev(`(() => { const v = document.querySelector("video"); v.currentTime = ${target}; return 0; })()`);
  await sleep(400); const outside = await settled("the player keeps its video after a seek");
  check(Math.abs(outside.time - target) < 3, "the seek outside the buffer happened", `to ${Math.round(target)} s, at ${Math.round(outside.time)} s`);
  check(outside.threads >= 16 && outside.threads > before.threads, "a seek outside the buffer starts with at least 16 threads", `${before.threads} -> ${outside.threads} threads`);
}

await ev(`(() => { const v = document.querySelector("video"); v.pause(); v.muted = false; return 0; })()`);
finish();
