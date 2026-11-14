// Plays one game's walkthrough in the headless player (headless.js) and
// writes what happened, step by step. Run by tools/geje-test/run.js, one
// process per game:
//
//   node tools/geje-test/play.js <game> <walkthrough.json> <out dir>
//
// The steps mean what they mean for tools/compare/run.js (same rules: verbs
// chosen and confirmed, objects hovered before the click, a step that changes
// nothing is played again up to 5 times, `until`, speech skipped after 0.8 s),
// so the time each step takes here is what it takes in the browser at speed 1.
//
// Out: <out>/log.jsonl (one line per step: state, time, lines said, events,
// commands, animations, problems), <out>/play.json (the summary).
import fs from "node:fs";
import path from "node:path";
import { openGame, takeProblems, noteProblem, clock } from "./headless.js";

const [name, walkFile, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const walk = JSON.parse(fs.readFileSync(walkFile, "utf8"));
const logOut = fs.createWriteStream(path.join(outDir, "log.jsonl"));

process.on("unhandledRejection", (e) => noteProblem("exception", (e && e.stack) || String(e)));
process.on("uncaughtException", (e) => noteProblem("exception", (e && e.stack) || String(e)));
// expected without a browser: not a problem of the game
const EXPECTED = /^shaders: this browser has no WebGL2/;
for (const k of ["error", "warn"]) {
  console[k] = (...a) => EXPECTED.test(String(a[0])) || noteProblem(`console-${k}`, a.map((x) => (x && x.stack) || (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" "));
}

// ---- what the engine says while a step runs
let events = [], commands = [];
const p = await openGame(name, {
  log(msg, level) {
    if (level === "event") events.push(String(msg).trim());
    else if (level === "command") commands.push(`${clock.t.toFixed(3)} ${String(msg).trim()}`);
  },
});
const { esc, gameUI, probe, size } = p;
// the walkthrough's language (its texts: menu buttons, dialog options), whatever the game starts in
if (walk.locale) esc.game.locale = walk.locale;

// ---- animations: every AnimatedSprite2D / AnimationPlayer, frame by frame
const { AnimPlayer } = await import(new URL("../../src/godot/animation_player.js", import.meta.url));
const { Movable } = await import(new URL("../../src/escoria/movable.js", import.meta.url));
const { spriteAnimation } = await import(new URL("../../src/godot/animation.js", import.meta.url));
const ownerOf = (n) => {
  for (let x = n; x; x = x.parent) if (x.props && x.props.global_id) return x.props.global_id;
  return n.name;
};
let animPlays = []; // this step: "who:anim"
const animIssues = [];
const issue = (level, msg) => animIssues.push({ level, msg, t: +clock.t.toFixed(2) });
// a name that doesn't exist (Godot: an error and nothing plays)
const origPlay = AnimPlayer.prototype.play;
AnimPlayer.prototype.play = function (nm, ...rest) {
  if (nm && !this.has(nm)) issue("error", `${ownerOf(this.node)}: play "${nm}", an animation it doesn't have (${this.names().join(", ")})`);
  return origPlay.call(this, nm, ...rest);
};
const origMovPlay = Movable.prototype.play;
Movable.prototype.play = function (nm) {
  if (!this.animator && this.sprite && nm) {
    const has = (this.sprite.props.sprite_frames?.props?.animations || []).some((a) => a.name === nm);
    if (!has) issue("error", `${ownerOf(this.item)}: play "${nm}", an animation it doesn't have`);
  }
  return origMovPlay.call(this, nm);
};
const tracked = new Map(); // node -> {who, anim, t0, seen, total, loop, cycle, last}
const finish = (node, r) => {
  tracked.delete(node);
  if (!r.total) return;
  const dur = clock.t - r.t0;
  const st = node.state;
  const done = !r.loop && !st.playing && st.animation === r.anim;
  if (r.seen.size < r.total && (done || (r.loop && dur >= r.cycle * 1.05)))
    issue("warn", `${r.who}: "${r.anim}" showed ${r.seen.size}/${r.total} frames in ${dur.toFixed(2)} s (${r.loop ? "loop of " + r.cycle.toFixed(2) + " s" : "ended"})`);
};
const allAnims = new Map(); // "who:anim" -> {plays, framesSeen, total}
p.tickers.push(() => {
  if (!esc.view) return;
  const alive = new Set();
  for (const tree of [esc.view.room, esc.screenRoot]) {
    for (const n of tree.walk()) {
      if (n.type === "AnimationPlayer") {
        const st = n.state;
        if (!st.playing || !st.current) continue;
        alive.add(n);
        const r = tracked.get(n);
        if (r && r.anim === st.current) continue;
        if (r) finish(n, r);
        tracked.set(n, { who: ownerOf(n), anim: st.current, t0: clock.t, seen: new Set(), total: 0 });
        animPlays.push(`${ownerOf(n)}:${st.current}`);
        continue;
      }
      if (n.type !== "AnimatedSprite2D") continue;
      const st = n.state;
      if (!st.playing) continue;
      alive.add(n);
      let r = tracked.get(n);
      const name = st.animation ?? n.props.animation ?? "default";
      if (r && r.anim !== name) {
        finish(n, r);
        r = null;
      }
      if (!r) {
        const a = spriteAnimation(n);
        const frames = (a && a.frames) || [];
        const fps = ((a && a.speed) || 5) * (n.props.speed_scale ?? 1);
        r = { who: ownerOf(n), anim: name, t0: clock.t, seen: new Set(), total: frames.length, loop: a ? a.loop ?? true : true, cycle: frames.reduce((s, f) => s + (f.duration ?? 1), 0) / (fps || 1), last: st.frame ?? 0 };
        tracked.set(n, r);
        animPlays.push(`${r.who}:${name}`);
      }
      // the frames in between too (a long tick can step over one)
      const f = st.frame ?? 0;
      if (r.total) {
        const step = st.backwards ? -1 : 1;
        for (let i = r.last, k = 0; k <= r.total; i = (i + step + r.total) % r.total, k++) {
          r.seen.add(i);
          if (i === f) break;
        }
      }
      r.last = f;
      const k = `${r.who}:${name}`;
      const g = allAnims.get(k) || { plays: 0, frames: new Set(), total: r.total };
      if (!allAnims.has(k)) allAnims.set(k, g);
      for (const x of r.seen) g.frames.add(x);
    }
  }
  // stopped or gone (a room changed): done
  for (const [n, r] of tracked) if (!alive.has(n)) finish(n, r);
});

// ---- checks of what a player would see (player/checks.js; issues of the step they happen in)
const FRAME = 1 / 30;
const { installChecks } = await import(new URL("../../player/checks.js", import.meta.url));
p.tickers.push(installChecks({ esc, gameUI, Movable, drawn: p.drawn, now: () => clock.t, issue }));

// ---- time
const frames = async (seconds) => {
  for (let t = 0; t < seconds - 1e-9; t += FRAME) {
    p.tick(FRAME);
    await new Promise((r) => setImmediate(r));
  }
};

// ---- the driver (player/walkthrough_driver.js), on the headless player
const { createDriver, NOISE } = await import(new URL("../../player/walkthrough_driver.js", import.meta.url));
const state = () => probe.state();
const driver = createDriver(walk, {
  state,
  where: (t) => probe.where(t),
  hover: (q) => p.hover(q),
  click: (q) => p.click(q),
  wheel: (dy) => p.wheel(dy),
  key: (k) => p.key(k),
  wait: frames,
  now: () => clock.t,
  size,
  inInventory: (id) => esc.inventory.has(id),
  describe(id) {
    const o = esc.objects.get(id);
    return `${id}: active ${o && o.active}, interactive ${o && o.interactive}, z ${o && o.node.props.z_index}`;
  },
});
const waitFor = driver.waitFor;

// ---- the walkthrough
const brief = (s) => ({
  room: s.room,
  inventory: s.inventory,
  globals: Object.fromEntries(Object.entries(s.globals || {}).filter(([k]) => !NOISE.test(k))),
  chooser: s.chooser,
  ended: s.ended,
});
const steps = [];
let failure = null, n = 0;
const t0Real = Date.now();
await frames(0.5);
try {
  for (const step of walk.steps) {
    n++;
    const start = clock.t;
    events = [];
    commands = [];
    animPlays = [];
    p.said.length = 0;
    const issuesBefore = animIssues.length;
    let err = null, errStack = null;
    try {
      await driver.play(step);
    } catch (e) {
      err = e.message;
      errStack = (e.stack || "").split("\n").slice(1, 6).map((l) => l.trim()).join(" | ");
    }
    const rec = {
      n,
      step,
      t: +start.toFixed(2),
      seconds: +(clock.t - start).toFixed(2),
      state: brief(state()),
      said: [...p.said],
      events,
      commands,
      anims: animPlays.filter((x, i, a) => x !== a[i - 1]),
      animIssues: animIssues.slice(issuesBefore),
      problems: takeProblems(),
      ...(err ? { error: err, stack: errStack } : {}),
    };
    steps.push(rec);
    logOut.write(JSON.stringify(rec) + "\n");
    if (err) {
      failure = `step ${n}: ${err}`;
      break;
    }
  }
  if (!failure) await waitFor((s) => s.ended, "the end of the game", 60).catch(() => {});
} catch (e) {
  failure = `step ${n}: ${e.message}`;
}
for (const [node, r] of tracked) finish(node, r);
const leftover = takeProblems();
const animCoverage = [...allAnims].map(([k, g]) => ({ anim: k, frames: g.frames.size, total: g.total })).filter((a) => a.total && a.frames < a.total);
const result = {
  game: name,
  ok: !failure,
  failure,
  steps: steps.length,
  total: walk.steps.length,
  ended: !!state().ended,
  gameSeconds: +clock.t.toFixed(1),
  realSeconds: +((Date.now() - t0Real) / 1000).toFixed(1),
  skippedLines: driver.stats.skipped,
  retries: driver.stats.retries,
  errors: steps.reduce((s, r) => s + r.problems.filter((x) => /error|exception/.test(x.kind)).length + r.animIssues.filter((x) => x.level === "error").length, 0) + leftover.length,
  warnings: steps.reduce((s, r) => s + r.problems.filter((x) => !/error|exception/.test(x.kind)).length + r.animIssues.filter((x) => x.level === "warn").length, 0),
  leftover,
  animsNotFullySeen: animCoverage,
};
fs.writeFileSync(path.join(outDir, "play.json"), JSON.stringify(result, null, 2));
logOut.end(() => process.exit(0));
