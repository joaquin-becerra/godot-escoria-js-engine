// The fast regression test: every game of geje-test/games.json, in Node, no
// browser (a minute or two for all). For each game:
//   1. static checks (static.js): .esc scripts, compat.js, animations
//   2. its walkthrough in the headless player (play.js) on a virtual clock:
//      state, lines, events, commands and animations of each step, and how
//      long each step takes in game time (what the video test will take)
//   3. a comparison with its golden run (geje-test/golden/<game>.json)
//
//   node tools/geje-test/run.js [game ...] [--update] [--export] [--jobs N]
//
// --update: this run becomes the golden one (after checking it's right).
// --export: export the game again from its project first (games.json "src").
// Out: geje-test/results/<game>/ (log.jsonl, play.json, REPORT.txt) and one
// line per game. Exit code 1 if a game failed or differs from its golden run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { staticChecks } from "./static.js";

const engineDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const testDir = path.join(engineDir, "geje-test");
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const jobsArg = args.indexOf("--jobs");
const jobs = jobsArg >= 0 ? +args[jobsArg + 1] : Math.max(1, Math.min(4, os.cpus().length - 1));
const wanted = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--jobs");
const manifest = JSON.parse(fs.readFileSync(path.join(testDir, "games.json"), "utf8")).games;
const games = manifest.filter((g) => !wanted.length || wanted.includes(g.game) || wanted.includes(g.short));
if (!games.length) {
  console.log(`no such game; the suite: ${manifest.map((g) => g.short || g.game).join(", ")}`);
  process.exit(2);
}
const PLAY_TIMEOUT = 20 * 60 * 1000; // real time: a game that hangs the event loop

const mmss = (s) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;

async function testGame(g) {
  const out = path.join(testDir, "results", g.game);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const report = [];
  if (flag("--export")) {
    const r = spawnSync(process.execPath, [path.join(engineDir, "tools/export.js"), path.resolve(engineDir, g.src)], { encoding: "utf8" });
    fs.writeFileSync(path.join(out, "export.txt"), r.stdout + r.stderr);
    if (r.status) return { g, fatal: `export failed (see ${path.relative(engineDir, out)}/export.txt)` };
  }
  if (!fs.existsSync(path.join(engineDir, "geje-builds", g.game, "game.json"))) return { g, fatal: "not exported (geje-builds/" + g.game + ")" };

  // 1. static
  const st = await staticChecks(g.game);
  const issueKey = (i) => `${i.level} ${i.kind} ${i.where} ${i.msg}`;

  // 2. walkthrough
  const play = await new Promise((ok) => {
    const child = spawn(process.execPath, [path.join(engineDir, "tools/geje-test/play.js"), g.game, path.join(testDir, g.walk), out], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", () => {});
    const timer = setTimeout(() => child.kill("SIGKILL"), PLAY_TIMEOUT);
    child.on("exit", (code, sig) => {
      clearTimeout(timer);
      const f = path.join(out, "play.json");
      if (fs.existsSync(f)) return ok(JSON.parse(fs.readFileSync(f, "utf8")));
      ok({ ok: false, failure: sig ? `killed after ${PLAY_TIMEOUT / 60000} min (hung?)` : `crashed (exit ${code}): ${err.trim().split("\n").slice(-3).join(" | ")}`, steps: 0, total: 0, errors: 1, warnings: 0, gameSeconds: 0 });
    });
  });
  const log = fs.existsSync(path.join(out, "log.jsonl"))
    ? fs.readFileSync(path.join(out, "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

  // 3. golden
  const current = {
    static: { verdict: st.verdict, issues: st.issues.map(issueKey).sort() },
    ended: play.ended,
    gameSeconds: play.gameSeconds,
    steps: log.map((r) => ({ n: r.n, seconds: r.seconds, state: r.state, anims: r.anims, said: r.said, error: r.error || null })),
  };
  const goldenFile = path.join(testDir, "golden", `${g.game}.json`);
  const golden = fs.existsSync(goldenFile) ? JSON.parse(fs.readFileSync(goldenFile, "utf8")) : null;
  const diffs = [];
  const notes = [];
  if (golden && !flag("--update")) {
    if (golden.static.verdict !== current.static.verdict) diffs.push(`static: verdict ${golden.static.verdict} -> ${current.static.verdict}`);
    const before = new Set(golden.static.issues), now = new Set(current.static.issues);
    for (const i of now) if (!before.has(i)) diffs.push(`static: new: ${i}`);
    for (const i of before) if (!now.has(i)) notes.push(`static: gone: ${i}`);
    if (golden.ended !== current.ended) diffs.push(`end of the game: ${golden.ended} -> ${current.ended}`);
    const n = Math.max(golden.steps.length, current.steps.length);
    for (let i = 0; i < n; i++) {
      const a = golden.steps[i], b = current.steps[i];
      if (!a || !b) {
        diffs.push(`step ${i + 1}: ${a ? "not played now" : "not played in the golden run"}`);
        continue;
      }
      const sa = a.state, sb = b.state;
      if (sa.room !== sb.room) diffs.push(`step ${b.n}: room ${sa.room} -> ${sb.room}`);
      if (JSON.stringify(sa.inventory) !== JSON.stringify(sb.inventory)) diffs.push(`step ${b.n}: inventory ${JSON.stringify(sa.inventory)} -> ${JSON.stringify(sb.inventory)}`);
      if (sa.chooser !== sb.chooser) diffs.push(`step ${b.n}: chooser ${sa.chooser} -> ${sb.chooser}`);
      for (const k of new Set([...Object.keys(sa.globals), ...Object.keys(sb.globals)]))
        if (JSON.stringify(sa.globals[k]) !== JSON.stringify(sb.globals[k])) diffs.push(`step ${b.n}: global ${k} ${JSON.stringify(sa.globals[k])} -> ${JSON.stringify(sb.globals[k])}`);
      if (JSON.stringify(a.anims) !== JSON.stringify(b.anims)) diffs.push(`step ${b.n}: animations ${listDiff(a.anims, b.anims)}`);
      if (JSON.stringify(a.said) !== JSON.stringify(b.said)) diffs.push(`step ${b.n}: lines ${listDiff(a.said, b.said)}`);
      if ((a.error || null) !== (b.error || null)) diffs.push(`step ${b.n}: error ${a.error} -> ${b.error}`);
      const dt = b.seconds - a.seconds;
      if (Math.abs(dt) > Math.max(1, a.seconds * 0.25)) notes.push(`step ${b.n}: ${a.seconds}s -> ${b.seconds}s`);
    }
  }
  // a golden run has to be a whole one (a stopped run would hide later steps)
  const saveGolden = (flag("--update") || !golden) && play.ok;
  if (saveGolden) {
    fs.mkdirSync(path.dirname(goldenFile), { recursive: true });
    fs.writeFileSync(goldenFile, JSON.stringify(current, null, 1));
  }

  // report
  const errs = st.issues.filter((i) => i.level === "error");
  report.push(`${g.game} · ${new Date().toISOString()}`);
  report.push(`static: ${st.verdict} · ${errs.length} errors · ${st.issues.length - errs.length} warnings`);
  for (const i of st.issues) report.push(`  ${i.level === "error" ? "✗" : "△"} [${i.kind}] ${i.where ? i.where + ": " : ""}${i.msg}`);
  report.push(`walkthrough: ${play.ok ? "OK" : "STOPPED: " + play.failure} · ${play.steps}/${play.total} steps · game time ${mmss(play.gameSeconds)} · real ${play.realSeconds} s · lines skipped ${play.skippedLines} · retries ${play.retries}`);
  report.push(`estimated time per step (game seconds):`);
  for (const r of log) report.push(`  ${String(r.n).padStart(3)} ${String(r.seconds).padStart(7)}  ${JSON.stringify(r.step)}${r.error ? "  ✗ " + r.error : ""}`);
  report.push(`problems while playing:`);
  for (const r of log) {
    for (const x of r.problems) report.push(`  step ${r.n} [${x.kind}] ${x.msg.split("\n")[0]}`);
    for (const x of r.animIssues) report.push(`  step ${r.n} [anim ${x.level}] ${x.msg}`);
  }
  for (const x of play.leftover || []) report.push(`  end [${x.kind}] ${x.msg.split("\n")[0]}`);
  if ((play.animsNotFullySeen || []).length) {
    report.push(`animations never shown whole (frames seen / total):`);
    for (const a of play.animsNotFullySeen) report.push(`  ${a.anim} ${a.frames}/${a.total}`);
  }
  report.push(golden && !flag("--update") ? `against the golden run: ${diffs.length} differences` : saveGolden ? `golden run ${golden ? "updated" : "created"}: ${path.relative(engineDir, goldenFile)}` : "no golden run saved (the walkthrough stopped)");
  for (const d of diffs) report.push(`  ≠ ${d}`);
  for (const d of notes) report.push(`  · ${d}`);
  fs.writeFileSync(path.join(out, "REPORT.txt"), report.join("\n") + "\n");
  return { g, st, play, diffs, golden: !!golden, saveGolden };
}

const listDiff = (a = [], b = []) => {
  const A = new Set(a), B = new Set(b);
  const minus = a.filter((x) => !B.has(x)), plus = b.filter((x) => !A.has(x));
  if (!minus.length && !plus.length) return "(same, other order)";
  return [...minus.map((x) => `-${x}`), ...plus.map((x) => `+${x}`)].slice(0, 6).join(" ") + (minus.length + plus.length > 6 ? " …" : "");
};

// ---- run, a few games at a time
const t0 = Date.now();
const queue = [...games];
const results = [];
const line = (r) => {
  const name = (r.g.short || r.g.game).padEnd(10);
  if (r.fatal) return `${name} ✗ ${r.fatal}`;
  const se = r.st.issues.filter((i) => i.level === "error").length;
  const p = r.play;
  const diff = r.golden && !flag("--update") ? `${r.diffs.length} differences` : r.saveGolden ? (r.golden ? "golden updated" : "golden created") : "no golden";
  const ok = p.ok && !r.diffs.length && !p.errors && !se;
  return `${name} ${ok ? "✓" : "✗"} ${p.steps}/${p.total} steps${p.ok ? "" : " (" + p.failure + ")"} · static ${r.st.verdict}${se ? ", " + se + " errors" : ""} · ${p.errors} errors · ${p.warnings} warnings · ${diff} · game ${mmss(p.gameSeconds)}`;
};
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (queue.length) {
      const g = queue.shift();
      let r;
      try {
        r = await testGame(g);
      } catch (e) {
        r = { g, fatal: e.stack || e.message };
      }
      results.push(r);
      console.log(line(r));
    }
  }),
);
const bad = results.filter((r) => r.fatal || !r.play.ok || (r.golden && !flag("--update") && r.diffs.length));
console.log(`${results.length} games in ${((Date.now() - t0) / 1000).toFixed(0)} s · reports in geje-test/results/<game>/REPORT.txt${bad.length ? ` · ${bad.length} with problems` : ""}`);
process.exit(bad.length ? 1 : 0);
