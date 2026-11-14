// Records a game's walkthrough to a video in headless Chrome (geje.record(),
// player/geje_test.js): fixed steps of game time per frame, so the video is
// smooth whatever the machine's pace; ffmpeg (through tools/serve.js) makes it.
//
//   node tools/geje-test/record.js <game> [--speed 4] [--fps 30] [--from n] [--to n] [--walk x.json] [--hold 2] [--port 8090]
//
// <game>: its folder in geje-builds/ or its short name in geje-test/games.json.
// Out: out/videos/<game>_<speed>x.mp4. Uses the server on --port if there is
// one (node tools/serve.js), else starts it.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const engineDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const wanted = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const suite = JSON.parse(fs.readFileSync(path.join(engineDir, "geje-test", "games.json"), "utf8")).games;
const entry = suite.find((g) => g.game === wanted || g.short === wanted);
if (!entry) {
  console.log(`usage: record.js <game> [--speed 4] [--fps 30] [--from n] [--to n]; games: ${suite.map((g) => g.short).join(", ")}`);
  process.exit(2);
}
const port = +opt("port", 8090);
const opts = { speed: +opt("speed", 4), fps: +opt("fps", 30) };
if (opt("from")) opts.from = +opt("from");
if (opt("to")) opts.to = +opt("to");
if (opt("walk")) opts.walk = opt("walk");
if (opt("hold")) opts.hold = +opt("hold");

// the server (with its /__rec endpoints)
const up = () => fetch(`http://localhost:${port}/geje-test/games.json`).then((r) => r.ok).catch(() => false);
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, [path.join(engineDir, "tools/serve.js"), String(port)], { stdio: ["ignore", "pipe", "inherit"] });
  server.stdout.on("data", (d) => process.stdout.write(String(d).replace(/^/gm, "  [serve] ")));
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=gl"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s`;
page.on("console", (m) => {
  const t = m.text();
  if (/^\[geje\]|%c\[geje\]/.test(t) || m.type() === "error") console.log(`${elapsed()} ${t.replace(/%c/g, "").replace(/ (font-weight|color):[^]*$/, "")}`);
});
page.on("pageerror", (e) => console.log(`${elapsed()} pageerror: ${e.message}`));
await page.goto(`http://localhost:${port}/player/index.html?game=${entry.game}`);
await page.waitForFunction(() => window.geje, null, { timeout: 120000 });
console.log(`${elapsed()} recording ${entry.game} at ${opts.speed}x, ${opts.fps} fps`);
const result = await page.evaluate((o) => window.geje.record(o).then((r) => ({ ok: r.ok, summary: r.summary, video: r.video, frames: r.frames, seconds: r.seconds })), opts);
console.log(`${elapsed()} ${result.ok ? "OK" : "STOPPED"} · ${result.summary}`);
console.log(`${elapsed()} video: ${result.video} · ${result.frames} frames · ${(result.seconds / 60).toFixed(1)} min`);
await browser.close();
if (server) server.kill();
process.exit(result.ok ? 0 : 1);
