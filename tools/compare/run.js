// Plays a walkthrough in a browser with the real mouse, in either engine (the
// JS player or Godot's web build with the probe.gd autoload), and keeps the
// evidence: a video, a screenshot and the game's state after each step, and
// the console. Both pages give window.__probe (player/probe.js, probe.gd).
//
//   node tools/compare/run.js --engine js|godot --url URL --walk tools/walkthroughs/x.json
//        [--out out/compare/x] [--speed 1] [--headed]
//
// Output in <out>/<engine>/: video.webm, NN.png, steps.jsonl, console.log, result.json
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : a), []),
);
const engine = args.engine;
const walkFile = args.walk;
if (!engine || !args.url || !walkFile) {
  console.error("usage: run.js --engine js|godot --url URL --walk walkthrough.json [--out dir] [--speed 1] [--headed]");
  process.exit(2);
}
const speed = +(args.speed || 1);
// a click skips each line of speech after SKIP_AFTER s (as a player does); --no-skip: no
const SKIP_AFTER = args["no-skip"] ? Infinity : 0.8;
const outDir = path.resolve(args.out || `out/compare/${path.basename(walkFile, ".json")}`, engine);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const walk = JSON.parse(fs.readFileSync(walkFile, "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const consoleLog = fs.createWriteStream(path.join(outDir, "console.log"));
const stepsLog = fs.createWriteStream(path.join(outDir, "steps.jsonl"));
const log = (m) => console.log(`[${engine}] ${m}`);

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: !args.headed,
  // the real GPU (--swiftshader: software WebGL, much slower for Godot)
  args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist", ...(args.swiftshader ? ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] : ["--enable-gpu", "--use-angle=gl"])],
});
const VIEW = { width: 1280, height: 720 };
// the walkthroughs name the options by their English text (first_run_locale.gd follows the browser)
const context = await browser.newContext({ locale: "en-US", viewport: VIEW, recordVideo: { dir: outDir, size: VIEW } });
const page = await context.newPage();
const t0 = Date.now();
const elapsed = () => (Date.now() - t0) / 1000;
// Godot's web build sends its push_warning() to console.error too: a
// "WARNING:" is a warning, not an error; the "at:" line after a message is
// part of it
let errors = 0, warnings = 0;
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && !/^\s*at: /.test(t)) {
    if (/^\s*WARNING:/.test(t)) warnings++;
    else errors++;
  }
  consoleLog.write(`${elapsed().toFixed(2)} ${m.type()}: ${m.text()}\n`);
});
page.on("pageerror", (e) => {
  errors++;
  consoleLog.write(`${elapsed().toFixed(2)} pageerror: ${e.message}\n`);
});

// a page that does not answer in 10 s is hung
const probe = (expr, arg) =>
  Promise.race([
    page.evaluate(([e, a]) => (window.__probe ? window.__probe[e](a) : null), [expr, arg]),
    sleep(10000).then(() => {
      throw new Error(`the page doesn't answer (${expr})`);
    }),
  ]);
const state = () => probe("state");

// game pixels -> page pixels (the canvas may be scaled)
let size = null;
const toPage = async (q) => {
  const r = await page.locator("canvas").first().boundingBox();
  return { x: r.x + (q.x / size.w) * r.width, y: r.y + (q.y / size.h) * r.height };
};
const click = async (q, id) => {
  let s = await toPage(q);
  await page.mouse.move(s.x, s.y, { steps: 5 });
  await sleep(150); // a couple of frames: hover before the click
  // a room object: it has to be under the mouse (someone walking may cover it)
  for (let i = 0; id && i < 30; i++) {
    await sleep(200); // the Godot probe publishes every 6 frames
    if ((await state()).hover === id) break;
    if (i === 29) throw new Error(`${id} doesn't stay under the mouse`);
    const q2 = await probe("where", { object: id });
    if (q2) s = await toPage(q2);
    await page.mouse.move(s.x + (i % 2), s.y, { steps: 2 });
  }
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(200);
};

// a line of speech shown for a while: a click on the sentence line (nothing
// there takes it as an order if the line is gone by then)
let speech = null, speechSince = 0, skipped = 0;
const skipSpeech = async (s) => {
  if (s.speech !== speech) (speech = s.speech), (speechSince = Date.now());
  if (!speech || (Date.now() - speechSince) / 1000 < SKIP_AFTER) return;
  // walk.skipKey: a key skips the line (a click would walk where the game has no sentence line)
  if (walk.skipKey) await page.keyboard.press(walk.skipKey);
  else {
    const p = await toPage({ x: size.w / 2, y: size.h * 0.76 });
    await page.mouse.click(p.x, p.y);
  }
  skipped++;
  speechSince = Date.now(); // the same line again (a repeated text): another click later
};

// cond(state) has to hold `steady` checks in a row (100 ms each)
const waitFor = async (cond, what, seconds = 180, steady = 3) => {
  const start = Date.now();
  let quiet = 0, last = null, report = start;
  while (quiet < steady) {
    if (Date.now() - report > 15000) {
      report = Date.now();
      log(`  waiting for ${what}: ${JSON.stringify(last && { ...last, globals: undefined })}`);
    }
    if (Date.now() - start > seconds * 1000) throw new Error(`didn't happen: ${what} (state: ${JSON.stringify(last && { ...last, globals: undefined })})`);
    await sleep(100);
    last = await state();
    quiet = last && (await cond(last)) ? quiet + 1 : 0;
    if (last) await skipSpeech(last);
  }
  return last;
};

const where = async (target, what) => {
  const q = await probe("where", target);
  if (!q) throw new Error(`can't find ${what}`);
  return q;
};

// A verb step that changes nothing (globals, inventory, room, chooser) is a
// lost click (someone walked in the way, the target walked away): it is
// played again, up to 5 times, as a player clicks again. "until" says what
// has to happen instead: "chooser" | {"inventory": id} | {"lost": id} (it left
// the inventory) | {"room": id} | false (nothing has to change)
// globals that change on any click or by themselves (scumm2escoria's action
// bookkeeping, roaming) don't count
const NOISE = /^scumm_(a_|object_|roam_)/;
const fingerprint = (s) =>
  JSON.stringify([s.room, s.inventory, s.chooser, Object.entries(s.globals || {}).filter(([k]) => !NOISE.test(k))]);
const happened = (u, s, before) =>
  u === "chooser" ? s.chooser
  : u && u.inventory ? s.inventory.includes(u.inventory)
  : u && u.lost ? !s.inventory.includes(u.lost)
  : u && u.room ? s.room === u.room
  : fingerprint(s) !== before;

async function run(step) {
  const verbStep = step.verb || step.object || step.pick;
  if (!verbStep || step.until === false) return runOnce(step);
  for (let i = 1; ; i++) {
    const before = fingerprint(await state());
    await runOnce(step);
    // it happened (a cutscene may still be running), or the game is free again
    const s = await waitFor((s) => (step.until && happened(step.until, s, before)) || s.idle || s.chooser || s.ended, "the step to finish", 120, 5);
    if (happened(step.until, s, before)) return;
    if (i === 5) throw new Error(`the step changed nothing in 5 tries${step.until ? " (" + JSON.stringify(step.until) + ")" : ""}`);
    log(`  the step changed nothing: again (${i + 1})`);
  }
}

async function runOnce(step) {
  if (step.wait) return sleep((step.wait * 1000) / speed);
  // the game takes clicks again (a cutscene that waits for a click), no speech
  if (step.waitInput) return waitFor((s) => s.input && !s.speech && !s.chooser, "the game to take clicks", 300, 10);
  if (step.waitRoom) return waitFor((s) => s.room === step.waitRoom, `room ${step.waitRoom}`, 300);
  if (step.waitGlobal) return waitFor((s) => Object.entries(step.waitGlobal).every(([k, v]) => s.globals[k] === v), `global ${JSON.stringify(step.waitGlobal)}`, 300);
  if (step.click) {
    if (step.click === "title") await sleep(2500);
    return click({ x: size.w / 2, y: size.h / 3 });
  }
  // walk.world: [w, h] of the game's coordinates; a click there (a keypad)
  if (step.world) {
    await waitFor((s) => !s.speech, "no speech", 60, 3);
    await sleep(((step.before ?? 0.6) * 1000) / speed);
    const [ww, wh] = walk.world;
    return click({ x: (step.world[0] / ww) * size.w, y: (step.world[1] / wh) * size.h });
  }
  // a visible text of the game's UI (a menu button)
  if (step.text) {
    let q = null;
    await waitFor(async () => (q = await probe("where", { text: step.text })), `text "${step.text}"`, 120);
    return click(q);
  }
  // scripted UIs with a selector (Superfluous Returnz): click the object,
  // then the selector's label `pick`, then (with `item`) the inventory item
  if (step.pick) {
    const ids = [step.object].filter(Boolean);
    await waitFor(async (s) => s.idle && (!step.object || (await probe("where", { object: step.object }))), `being able to play with ${step.object}`, 300, 15);
    const s0 = await state();
    const inInv = s0.inventory.includes(step.object);
    // off screen (a scrolling room): walk to that side first (a click on the floor)
    for (let i = 0; !inInv && i < 4; i++) {
      const q = await where({ object: step.object }, step.object);
      if (q.x >= size.w * 0.03 && q.x <= size.w * 0.97) break;
      await click({ x: q.x < 0 ? size.w * 0.08 : size.w * 0.92, y: size.h * (walk.floorY ?? 0.88) });
      await waitFor((s) => s.idle, "walking to the side", 60, 5);
    }
    await click(await where({ object: step.object }, step.object), inInv ? null : step.object);
    let q = null;
    await waitFor(async () => (q = await probe("where", { text: step.pick })), `label "${step.pick}"`, 10, 2);
    await sleep(150);
    await click(q);
    if (step.item) {
      await sleep(700); // the inventory slides up
      let qi = null;
      await waitFor(async () => (qi = await probe("where", { object: step.item })), `inventory item ${step.item}`, 10, 3);
      await click(qi);
    }
    await sleep(400);
    return;
  }
  // an object clicked directly (an exit)
  if (step.go) {
    await waitFor(async (s) => s.idle && (await probe("where", { object: step.go })), `being able to go to ${step.go}`, 300, 15);
    await click(await where({ object: step.go }, step.go), step.go);
    return sleep(400);
  }
  if (step.choose) {
    await waitFor((s) => s.chooser && s.options.includes(step.choose), `option "${step.choose}"`, 120);
    return click(await where({ option: step.choose }, `option "${step.choose}"`));
  }
  // a verb on an object (with an item)
  const ids = [step.item, step.object].filter(Boolean);
  // the game takes input and the objects are there (the intro goes through other rooms first)
  const there = async () => {
    for (const id of ids) if (!(await probe("where", { object: id }))) return false;
    return true;
  };
  await waitFor(async (s) => s.idle && (await there()), `being able to play with ${ids.join(", ")}`, 300, 15);
  const vp = step.verb === "walk" ? null : await where({ verb: step.verb }, `verb ${step.verb}`);
  // the verb has to be chosen (a click can get lost while the game is busy)
  for (let i = 0; vp && i < 5; i++) {
    await click(vp);
    await sleep(250);
    if ((await state()).action === step.verb) break;
    if (i === 4) throw new Error(`verb ${step.verb} doesn't stay chosen (action ${(await state()).action})`);
  }
  const s = await state();
  const roomObject = (id) => (s.inventory.includes(id) ? null : id);
  if (step.item) await click(await where({ object: step.item }, step.item), roomObject(step.item));
  await click(await where({ object: step.object }, step.object), roomObject(step.object));
  await sleep(400);
}

// The step number in the video, in binary, as 5 squares of 12 px in the top
// left corner: the recording does not keep the clock's time (it drifts by tens
// of seconds), so diff.js reads where each step ends from these
const mark = (n) =>
  page.evaluate((n) => {
    let m = document.getElementById("__mark");
    if (!m) {
      m = document.createElement("div");
      m.id = "__mark";
      m.style.cssText = "position:fixed;left:0;top:0;display:flex;z-index:99999;pointer-events:none";
      for (let i = 0; i < 5; i++) m.appendChild(document.createElement("div")).style.cssText = "width:12px;height:12px";
      document.body.appendChild(m);
    }
    [...m.children].forEach((c, i) => (c.style.background = (n >> i) & 1 ? "#fff" : "#000"));
  }, n).catch(() => {});

let ok = true, failure = null, n = 0;
try {
  log(`abriendo ${args.url}`);
  await page.goto(args.url);
  await page.waitForFunction(() => window.__probe && window.__probe.size(), null, { timeout: 180000, polling: 500 });
  size = await probe("size");
  if (speed !== 1) await probe("setSpeed", speed);
  await mark(0);
  log(`probe ready (${size.w}x${size.h}) at ${elapsed().toFixed(1)} s`);
  for (const step of walk.steps) {
    n++;
    const start = elapsed();
    log(`step ${n}/${walk.steps.length}: ${JSON.stringify(step)}`);
    await run(step);
    // the step's result: the game free again (or a chooser, or the end)
    // (busy: the walkthrough says it won't be free again)
    const s = (!step.busy && (await waitFor((s) => s.idle || s.chooser || s.ended, "the step to finish", 120, 5).catch(() => null))) || (await state());
    await page.locator("canvas").first().screenshot({ path: path.join(outDir, `${String(n).padStart(2, "0")}.png`) });
    await mark(n);
    stepsLog.write(JSON.stringify({ n, step, start, end: elapsed(), state: s }) + "\n");
  }
  await waitFor((s) => s.ended, "the end of the game", 60).catch(() => log("the game didn't report its end"));
} catch (e) {
  ok = false;
  failure = `step ${n}: ${e.message}`;
  log(`ERROR ${failure}`);
  await page.locator("canvas").first().screenshot({ path: path.join(outDir, "error.png") }).catch(() => {});
  stepsLog.write(JSON.stringify({ n, step: walk.steps[n - 1], error: e.message, end: elapsed(), state: await state().catch(() => null) }) + "\n");
}
await sleep(1500);
const video = page.video();
await context.close();
await browser.close();
const vfile = await video.path();
fs.renameSync(vfile, path.join(outDir, "video.webm"));
const result = { engine, url: args.url, ok, failure, steps: n, total: walk.steps.length, seconds: elapsed(), consoleErrors: errors, consoleWarnings: warnings, skippedLines: skipped };
fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
log(`${ok ? "FINISHED" : "STOPPED"} · ${n}/${walk.steps.length} steps · ${elapsed().toFixed(0)} s · console errors ${errors} · ${outDir}`);
process.exit(ok ? 0 : 1);
