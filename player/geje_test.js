// The walkthrough test in the browser, on the player's page (player/?game=...).
//
// Debug panel: player/?game=...&debug=1 (or geje.debug() in the console):
// speed (½x to 8x), ⏯ play / pause, ⏮ / ⏭ the previous / next step, and
// "go to" a step. The game state is kept at the start of every step played
// (Escoria's save data, in memory), so going back is instant; going forward to
// a step not played yet plays the steps in between in fast forward (12x),
// also while paused.
//
// From the console:
//   geje.run()                       the game's walkthrough (geje-test/games.json), 4x
//   geje.run({ speed: 2 })           another speed (1 = the game's own)
//   geje.run({ walk: "road.json" })  another walkthrough of geje-test/
//   geje.run({ from: 45, to: 47 })   steps 1-44 in fast forward (ff, 12x), then 45-47
//   geje.run({ from: 45, ff: 0 })    from step 45 on the game as it is now (no fast forward)
//   geje.debug()                     the panel, the walkthrough paused at step 1
//   geje.pause(), geje.play(), geje.go(n), geje.speed(x), geje.stop()
//   geje.panel(false) / geje.panel()  hides / shows the panel (also ✕, the tab, F2)
//   geje.record({ speed: 4 })        a video of the walkthrough, out/videos/<game>_4x.mp4
//                                    (hold: seconds of video the last frame stays, 2)
//                                    (fixed steps of game time: smooth whatever the
//                                    browser's pace; tools/serve.js runs ffmpeg)
//
// The steps are played by player/walkthrough_driver.js (the same as the fast
// test in Node) through the player's own input path. On the page: the step
// being played and a ring where the mouse is. In the console: one line per
// step (its game time) and a summary at the end.

import { createDriver, NOISE } from "./walkthrough_driver.js";
import { installChecks } from "./checks.js";
import { Movable } from "../src/escoria/movable.js";

const SPEEDS = [0.5, 1, 2, 4, 8];
const FF = 12; // fast forward

class Jump extends Error {}
// the fast test's fixed seed (tools/geje-test/headless.js): without it OQ's
// roaming Zif goes elsewhere every run and gets in the way (2026-11-13)
const seedRandom = () => {
  let seed = 0x2545f491;
  Math.random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
};
class TooLong extends Error {} // a step that takes longer than expected
// a step may take this much longer than in the fast test (its golden run) before it fails
const BUDGET = (expected) => expected * 1.5 + 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the state after a step against the golden run's: room, inventory, globals
function stateDiffs(want, got) {
  const out = [];
  if (want.room !== got.room) out.push(`room ${want.room} -> ${got.room}`);
  if (JSON.stringify(want.inventory) !== JSON.stringify(got.inventory)) out.push(`inventory ${JSON.stringify(want.inventory)} -> ${JSON.stringify(got.inventory)}`);
  const keys = new Set([...Object.keys(want.globals || {}), ...Object.keys(got.globals || {})].filter((k) => !NOISE.test(k)));
  for (const k of keys) if (JSON.stringify(want.globals[k]) !== JSON.stringify(got.globals[k])) out.push(`global ${k} ${JSON.stringify(want.globals[k])} -> ${JSON.stringify(got.globals[k])}`);
  return out;
}

export function installGejeTest({ esc, gameUI, canvas, gameName, input, debug = false }) {
  const probe = window.__probe;

  // ---- the run
  const run = {
    walk: null, walkFile: "", driver: null,
    n: 1, to: 0, // the step being played, the last one
    speed: 4, paused: false, fastTo: 0, // steps below fastTo go at FF (even paused)
    snapshots: new Map(), // step -> Escoria save data at its start
    results: [], failure: null, active: false, t0: 0, real0: 0,
    golden: null, // geje-test/golden/<game>.json: each step's game time and state in the fast test
    issues: [], stepStart: 0, // [{n, level, msg}]
  };
  const fast = () => run.active && run.n < run.fastTo;
  const effectiveSpeed = () => (fast() ? FF : run.paused ? 0 : run.speed);
  // recording: the game runs at its own pace, the pump decides how much per frame
  const applySpeed = () => probe.setSpeed(rec ? 1 : effectiveSpeed());
  let rec = null; // a recording: {name, fps, speed, frames, on}
  // the golden run's game seconds for step n (null: no golden run, or it doesn't match the walkthrough)
  const expected = (n) => {
    const g = run.golden && run.golden.steps[n - 1];
    return g && typeof g.seconds === "number" ? g.seconds : null;
  };
  const eta = () => {
    if (!run.golden) return null;
    let s = 0;
    for (let k = run.n; k <= run.to; k++) s += expected(k) ?? 0;
    return s;
  };

  // ---- game time: real time x speed, frame by frame, as the player advances
  // it (Math.min(dt, 0.1), player.js frame()); paused, it stands still
  let clock = 0, last = 0;
  const waiters = [];
  let abort = null; // a Jump (go, stop): the pending waits fail with it
  const settle = () => {
    // longer than expected (the golden run's time for this step, with a margin): it fails
    const g = expected(run.n);
    if (run.active && !abort && !fast() && g !== null && clock - run.stepStart > BUDGET(g))
      abort = new TooLong(`took more than ${BUDGET(g).toFixed(0)} s of game time (the fast test: ${g.toFixed(1)} s)`);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (abort) waiters.splice(i, 1)[0].fail(abort);
      else if (clock >= waiters[i].at) waiters.splice(i, 1)[0].ok();
    }
  };
  const tick = (t) => {
    const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
    last = t;
    // recording: the pump moves the game and this clock (fixed steps)
    if (!rec) clock += dt * effectiveSpeed();
    settle();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const wait = (s) =>
    new Promise((ok, fail) => {
      if (abort) return fail(abort);
      waiters.push({ at: clock + s, ok, fail });
    });

  // ---- on the page: the panel, and a ring where the mouse is
  const ring = document.createElement("div");
  ring.style.cssText = "position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border:3px solid #f33;border-radius:50%;z-index:99999;pointer-events:none;display:none;transition:left .08s,top .08s";
  const panel = document.createElement("div");
  panel.style.cssText = "position:fixed;right:8px;top:8px;width:min(470px,50vw);padding:6px 10px;background:rgba(0,0,0,.8);color:#fff;font:13px/1.4 monospace;border-radius:4px;z-index:99999;display:none";
  panel.innerHTML = `
    <button data-a="hide" title="hide the panel (F2)" style="float:right">✕</button>
    <div data-k="controls" style="display:none;margin-bottom:4px">
      <button data-a="back" title="previous step">⏮</button>
      <button data-a="toggle" title="play / pause" style="min-width:2.4em">▶</button>
      <button data-a="next" title="next step">⏭</button>
      <span data-k="speeds" style="margin-left:8px"></span>
      <span style="margin-left:8px">step <input data-k="goto" type="number" min="1" style="width:4em" title="Enter: go to that step"></span>
    </div>
    <div data-k="text" style="white-space:pre-wrap"></div>`;
  // hidden: a small tab in its corner brings it back (also F2, geje.panel())
  const tab = document.createElement("button");
  tab.textContent = "GEJE ◂";
  tab.title = "show the test panel (F2)";
  tab.style.cssText = "position:fixed;right:8px;top:8px;z-index:99999;display:none;font:12px monospace;padding:2px 6px;background:rgba(0,0,0,.8);color:#fff;border:0;border-radius:4px;cursor:pointer";
  document.body.append(panel, ring, tab);
  let hidden = false;
  const setHidden = (h) => {
    hidden = h;
    panel.style.visibility = h ? "hidden" : "visible";
    tab.style.display = h && panel.style.display !== "none" ? "block" : "none";
  };
  tab.onclick = (e) => {
    e.stopPropagation();
    setHidden(false);
  };
  for (const ev of ["mousedown", "mouseup", "dblclick"]) tab.addEventListener(ev, (e) => e.stopPropagation());
  window.addEventListener("keydown", (e) => {
    if (e.key !== "F2" || panel.style.display === "none") return;
    e.preventDefault();
    e.stopPropagation();
    setHidden(!hidden);
  }, true);
  for (const b of panel.querySelectorAll("button")) b.style.cssText += ";font:14px monospace;padding:1px 6px;cursor:pointer";
  const $ = (k) => panel.querySelector(`[data-k="${k}"]`);
  const speeds = $("speeds");
  for (const x of SPEEDS) {
    const b = document.createElement("button");
    b.textContent = `${x === 0.5 ? "½" : x}x`;
    b.dataset.speed = x;
    b.style.cssText = "font:12px monospace;padding:1px 4px;margin-right:2px;cursor:pointer";
    b.onclick = () => api.speed(x);
    speeds.append(b);
  }
  panel.querySelector('[data-a="hide"]').onclick = () => setHidden(true);
  panel.querySelector('[data-a="back"]').onclick = () => api.go(run.n - 1);
  panel.querySelector('[data-a="next"]').onclick = () => api.go(run.n + 1);
  panel.querySelector('[data-a="toggle"]').onclick = () => (run.active && !run.paused ? api.pause() : api.play());
  $("goto").addEventListener("keydown", (e) => {
    e.stopPropagation(); // not the game's keys
    if (e.key === "Enter") api.go(+e.target.value);
  });
  // the panel's clicks and keys are not the game's
  for (const ev of ["mousedown", "mouseup", "click", "dblclick", "wheel", "keydown", "keyup"]) panel.addEventListener(ev, (e) => e.stopPropagation());

  let debugMode = debug;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  let note = "";
  const render = () => {
    panel.style.display = "block";
    if (hidden) tab.style.display = "block";
    $("controls").style.display = debugMode ? "block" : "none";
    panel.querySelector('[data-a="toggle"]').textContent = run.active && !run.paused ? "⏸" : "▶";
    for (const b of speeds.children) b.style.background = +b.dataset.speed === run.speed ? "#fc6" : "";
    if (document.activeElement !== $("goto")) $("goto").value = Math.min(run.n, run.to) || "";
    const step = run.walk && run.walk.steps[run.n - 1];
    const head = run.walk
      ? `${run.walkFile} · step ${Math.min(run.n, run.to)}/${run.to}${fast() ? `  ⏩ to ${run.fastTo}` : ""}${run.paused && !fast() ? "  ⏸" : ""}`
      : "GEJE test";
    const exp = run.active ? expected(run.n) : null, left = run.active ? eta() : null, sp = effectiveSpeed() || run.speed;
    const times = run.walk
      ? `game ${mmss(clock - run.t0)} · real ${mmss((performance.now() - run.real0) / 1000)} · ${effectiveSpeed()}x · kept ${run.snapshots.size} steps` +
        (exp !== null ? `\nthis step ${(clock - run.stepStart).toFixed(1)} s / expected ${exp.toFixed(1)} s` : "") +
        (left !== null ? ` · left ~${mmss(left / sp)} real` : "") +
        (run.issues.length ? ` · ⚠ ${run.issues.length}` : "")
      : "";
    const what = run.failure ? `✗ step ${run.failure.n}: ${run.failure.error}` : step ? JSON.stringify(step) : run.walk ? "end of the walkthrough" : "";
    $("text").textContent = [head, times, what, note].filter(Boolean).join("\n");
  };
  setInterval(() => run.walk && render(), 250);

  const toPage = (q) => {
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (q.x / canvas.width) * r.width, y: r.top + (q.y / canvas.height) * r.height };
  };
  let mouseAt = null, clickUntil = -1; // for the recorded frames (the ring is a page element)
  const moveRing = (q, clicking = false) => {
    mouseAt = q;
    if (clicking) clickUntil = clock + 0.15;
    const s = toPage(q);
    ring.style.display = "block";
    ring.style.left = `${s.x}px`;
    ring.style.top = `${s.y}px`;
    ring.style.background = clicking ? "rgba(255,50,50,.5)" : "transparent";
    if (clicking) setTimeout(() => (ring.style.background = "transparent"), 150);
  };

  // what a player would see (player/checks.js), after every frame of the player
  const checkFrame = installChecks({
    esc, gameUI, Movable, drawn: input.drawn, now: () => clock,
    issue(level, msg) {
      if (!run.active || fast()) return;
      run.issues.push({ n: run.n, level, msg });
      console.warn(`[geje] step ${run.n} ⚠ ${msg}`);
    },
  });
  input.afterFrame(() => run.active && checkFrame());

  const driverApi = {
    state: () => probe.state(),
    where: (t) => probe.where(t),
    hover(q) {
      moveRing(q);
      input.hover(q);
    },
    click(q) {
      moveRing(q, true);
      input.click(q);
    },
    wheel: (dy) => input.wheel(dy),
    key: (k) => input.key(k),
    wait,
    now: () => clock,
    size: { w: canvas.width, h: canvas.height },
    inInventory: (id) => esc.inventory.has(id),
    describe(id) {
      const o = esc.objects.get(id);
      return `${id}: active ${o && o.active}, interactive ${o && o.interactive}, z ${o && o.node.props.z_index}`;
    },
  };

  async function load(opts) {
    let walkFile = opts.walk;
    if (!walkFile) {
      const suite = await fetch("../geje-test/games.json").then((r) => r.json());
      const entry = suite.games.find((g) => g.game === gameName);
      if (!entry) throw new Error(`${gameName} has no walkthrough in geje-test/games.json`);
      walkFile = entry.walk;
    }
    run.walk = await fetch(`../geje-test/${walkFile}`).then((r) => r.json());
    // the fast test's golden run (Node): expected time and state of each step
    const gold = await fetch(`../geje-test/golden/${gameName}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    run.golden = gold && gold.steps.length === run.walk.steps.length ? gold : null;
    if (!run.golden) console.warn(`[geje] ${gold ? "the golden run doesn't match the walkthrough (npm test -- --update)" : "no golden run"}: no expected times`);
    run.walkFile = walkFile;
    // the walkthrough's language (its texts: menu buttons, dialog options), whatever the game starts in
    if (run.walk.locale) esc.game.locale = run.walk.locale;
    run.driver = createDriver(run.walk, driverApi);
    run.to = Math.min(run.walk.steps.length, opts.to ?? run.walk.steps.length);
  }

  // to the start of step t: back (or ahead, if it was played before) by the
  // latest snapshot at or before t, then fast forward up to t
  async function jumpTo(t) {
    t = Math.max(1, Math.min(t, run.to));
    const kept = [...run.snapshots.keys()].filter((k) => k <= t).sort((a, b) => b - a)[0];
    note = "";
    if (t < run.n && kept === undefined) note = `step ${t} wasn't kept (the game wasn't free then): from step ${run.n}`;
    else if (kept !== undefined && (t < run.n || kept > run.n)) {
      // Escoria's load: it stops what is running, changes room and restores the state
      await esc.loadData(run.snapshots.get(kept));
      run.n = kept;
    }
    run.fastTo = t;
    console.log(`[geje] → step ${t}${run.n < t ? ` (fast forward from ${run.n})` : ""}`);
    render();
  }

  // plays run.n to run.to; a Jump (go, stop) interrupts the step being played
  async function playLoop() {
    run.active = true;
    while (run.n <= run.to) {
      // paused between steps (not while fast forwarding): wait for play or a jump
      while (run.paused && !fast() && !abort) await sleep(100);
      if (abort) {
        const j = abort;
        abort = null;
        if (j.stop) break;
        await jumpTo(j.target);
        continue;
      }
      const n = run.n, step = run.walk.steps[n - 1];
      if (!run.snapshots.has(n) && probe.state().idle) run.snapshots.set(n, esc.saveData(`step ${n}`));
      applySpeed();
      render();
      const start = clock;
      run.stepStart = clock;
      try {
        await run.driver.play(step);
        // over the budget just as the step ended: it finished, so it's no failure
        // (left pending, the next turn took it for a jump to step NaN)
        if (abort instanceof TooLong) abort = null;
      } catch (e) {
        if (e instanceof Jump) continue; // the top of the loop takes it
        abort = null;
        run.failure = { n, step, error: e.message };
        console.error(`[geje] ${n}/${run.to} ✗ ${JSON.stringify(step)}: ${e.message}`);
        if (!debugMode) break;
        // debug: stop here; ▶ plays the step again, ⏮ / ⏭ / step go elsewhere
        run.paused = true;
        applySpeed();
        render();
        while (run.paused && !abort) await sleep(100);
        run.failure = null;
        if (!abort) await jumpTo(n);
        continue;
      }
      const secs = clock - start;
      if (n >= run.fastTo) {
        // against the golden run: the state after the step (as the fast test sees it)
        const g = run.golden && run.golden.steps[n - 1];
        const diffs = g ? stateDiffs(g.state, probe.state()) : [];
        for (const d of diffs) {
          run.issues.push({ n, level: "diff", msg: d });
          console.warn(`[geje] step ${n} ≠ the fast test: ${d}`);
        }
        const warns = run.issues.filter((x) => x.n === n).length;
        run.results.push({ n, step: JSON.stringify(step), "game s": +secs.toFixed(2), expected: g ? g.seconds : "", warnings: warns, room: probe.state().room });
        console.log(`[geje] ${n}/${run.to} ✓ ${secs.toFixed(1)} s${g ? ` (expected ${g.seconds.toFixed(1)})` : ""}${warns ? ` · ${warns} warnings` : ""} · ${JSON.stringify(step)}`);
      }
      run.n = n + 1;
    }
    run.active = false;
    abort = null;
    probe.setSpeed(1);
    ring.style.display = "none";
    const summary = `${run.failure ? `STOPPED at step ${run.failure.n}: ${run.failure.error}` : run.n > run.to ? `FINISHED to step ${run.to}` : `STOPPED at step ${run.n}`} · game ${mmss(clock - run.t0)} · real ${mmss((performance.now() - run.real0) / 1000)} · lines skipped ${run.driver.stats.skipped} · retries ${run.driver.stats.retries} · warnings ${run.issues.length}`;
    note = summary;
    render();
    console.log(`%c[geje] ${summary}`, `font-weight:bold;color:${run.failure ? "#c00" : "#080"}`);
    if (run.results.length) console.table(run.results);
    if (run.issues.length) console.table(run.issues);
    return { ok: !run.failure, failure: run.failure, steps: run.results, issues: run.issues, summary };
  }

  // ---- recording (geje.record()): manual frames of a fixed step of game time,
  // each one sent as a JPEG to tools/serve.js, where ffmpeg makes the video
  const yieldNow = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  const shot = document.createElement("canvas");
  async function sendFrame() {
    shot.width = canvas.width;
    shot.height = canvas.height;
    const g = shot.getContext("2d");
    g.drawImage(canvas, 0, 0);
    if (mouseAt) {
      g.beginPath();
      g.arc(mouseAt.x, mouseAt.y, 11, 0, Math.PI * 2);
      g.lineWidth = 3;
      g.strokeStyle = "#f33";
      g.stroke();
      if (clock < clickUntil) (g.fillStyle = "rgba(255,50,50,.5)"), g.fill();
    }
    const label = `${run.walkFile} · step ${Math.min(run.n, run.to)}/${run.to} · ${mmss(clock - run.t0)}`;
    g.font = "16px monospace";
    const w = g.measureText(label).width;
    g.fillStyle = "rgba(0,0,0,.6)";
    g.fillRect(4, shot.height - 26, w + 12, 22);
    g.fillStyle = "#fff";
    g.fillText(label, 10, shot.height - 9);
    const blob = await new Promise((r) => shot.toBlob(r, "image/jpeg", 0.88));
    await fetch(`/__rec/frame?name=${encodeURIComponent(rec.name)}`, { method: "POST", body: blob });
    rec.frames++;
  }
  async function pump() {
    const TICK = 1 / 30; // the longest step the game takes at once
    while (rec && rec.on) {
      if (run.paused && !fast()) {
        await sleep(100);
        continue;
      }
      // a video frame: speed / fps of game time (fast forward: more, and not recorded)
      const capture = !fast();
      const advance = capture ? rec.speed / rec.fps : (FF / rec.fps);
      const n = Math.max(1, Math.ceil(advance / TICK - 1e-9));
      for (let i = 0; i < n; i++) {
        input.step(advance / n);
        clock += advance / n;
        settle();
        await yieldNow(); // what the waits let go on (the driver, the game's scripts)
      }
      if (capture) await sendFrame();
    }
  }

  const start = () => {
    note = "";
    run.failure = null;
    return playLoop();
  };

  const api = {
    async run(opts = {}) {
      if (run.active) api.stop(), await sleep(200);
      await load(opts);
      seedRandom(); // like the fast test (tools/geje-test/headless.js): random roaming, shuffles...
      run.speed = opts.speed ?? run.speed;
      run.paused = !!opts.paused;
      run.n = 1;
      run.results = [];
      run.issues = [];
      run.snapshots.clear();
      const from = Math.max(1, opts.from ?? 1);
      const ff = opts.ff ?? FF;
      if (ff <= 0) run.n = from;
      run.fastTo = ff > 0 ? from : 0;
      run.t0 = clock;
      run.real0 = performance.now();
      console.log(`%c[geje] ${gameName} · ${run.walkFile} · steps ${from}-${run.to} · ${run.speed}x${run.n < from ? ` (1-${from - 1} fast forward ${FF}x)` : ""}`, "font-weight:bold");
      return start();
    },
    /**
     * Records the walkthrough to out/videos/<name>.mp4 (tools/serve.js and
     * ffmpeg): a video of `fps` frames per second showing the game at
     * `speed` (4: four times faster), whatever the browser's real pace.
     * Other options as run() (walk, from, to).
     */
    async record(opts = {}) {
      const name = (opts.name || `${gameName}${opts.speed && opts.speed !== 1 ? `_${opts.speed}x` : ""}`).replace(/[^\w.-]/g, "_");
      const fps = opts.fps || 30;
      rec = { name, fps, speed: opts.speed ?? 1, frames: 0, on: true };
      const r = await fetch(`/__rec/start?name=${encodeURIComponent(name)}&fps=${fps}`, { method: "POST" });
      if (!r.ok) throw new Error(`the server doesn't record (tools/serve.js): ${r.status}`);
      input.setManual(true);
      const real0 = performance.now();
      const pumping = pump();
      let result;
      try {
        result = await api.run({ ...opts, speed: 1 });
      } finally {
        rec.on = false;
        await pumping;
        // the last frame held a while (opts.hold seconds of video: at 4x the
        // walkthrough's last couple of game seconds would flash by)
        for (let i = 0; i < Math.round((opts.hold ?? 2) * fps); i++) await sendFrame();
        input.setManual(false);
      }
      const end = await fetch(`/__rec/end?name=${encodeURIComponent(name)}`, { method: "POST" }).then((x) => x.json()).catch(() => ({}));
      const frames = rec.frames;
      rec = null;
      probe.setSpeed(1);
      const msg = `video: ${end.file} · ${frames} frames (${mmss(frames / fps)}) · ${end.kb} KB · made in ${mmss((performance.now() - real0) / 1000)}`;
      console.log(`%c[geje] ${msg}`, "font-weight:bold");
      note = `${note}\n${msg}`;
      render();
      return { ...result, video: end.file, frames, seconds: frames / fps };
    },
    /** The debug panel: the walkthrough loaded and paused at step 1 (▶ starts it). */
    async debug(opts = {}) {
      debugMode = true;
      if (!run.walk || opts.walk) return api.run({ speed: 1, ...opts, paused: true });
      render();
    },
    pause() {
      run.paused = true;
      applySpeed();
      render();
    },
    play() {
      if (!run.walk) return api.run();
      run.paused = false;
      if (!run.active) start();
      applySpeed();
      render();
    },
    /** Shows (true / nothing) or hides (false) the panel. */
    panel(show = true) {
      setHidden(!show);
    },
    speed(x) {
      run.speed = +x;
      applySpeed();
      render();
    },
    /** To the start of step t (back: its snapshot; ahead: fast forward), keeping play / pause. */
    go(t) {
      if (!run.walk || !(t >= 1)) return;
      if (!run.active) return void jumpTo(t).then(start);
      abort = Object.assign(new Jump(`go ${t}`), { target: t });
    },
    stop() {
      if (run.active) abort = Object.assign(new Jump("stop"), { stop: true });
      run.paused = false;
      run.speed = 1;
      probe.setSpeed(1);
    },
  };
  window.geje = api;
  console.log("[geje] walkthrough test ready: geje.run() (4x), geje.debug() (panel), geje.run({ speed, walk, from, to, ff }), geje.stop()");
  if (debug) api.debug().catch((e) => console.error("[geje]", e));
}
