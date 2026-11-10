// Compares two runs of tools/compare/run.js (the JS engine and Godot's web
// build) step by step:
//   node tools/compare/diff.js out/compare/openquest [js godot]
// Output in that folder: REPORT.txt (room, inventory, globals, speech per
// step, differences marked), side_by_side/NN.png (the screenshots side by
// side) and side_by_side.mp4 (both videos cut by step and put side by side).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = path.resolve(process.argv[2] || "");
const [A, B] = [process.argv[3] || "js", process.argv[4] || "godot"];
const read = (e) => {
  const f = path.join(dir, e, "steps.jsonl");
  if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
  return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
};
const ra = read(A), rb = read(B);
const result = (e) => JSON.parse(fs.readFileSync(path.join(dir, e, "result.json"), "utf8"));
const resA = result(A), resB = result(B);
const ffmpeg = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);

const lines = [];
const out = (s = "") => lines.push(s);
const j = (v) => JSON.stringify(v);
out(`Comparison ${A} vs ${B} · ${new Date().toISOString().slice(0, 16)}`);
for (const r of [resA, resB]) out(`  ${r.engine}: ${r.ok ? "FINISHED" : "STOPPED (" + r.failure + ")"} · ${r.steps}/${r.total} steps · ${Math.round(r.seconds)} s · console errors ${r.consoleErrors}${r.consoleWarnings ? " (+" + r.consoleWarnings + " warnings)" : ""}`);
out();

let diffs = 0;
const n = Math.max(ra.length, rb.length);
for (let i = 0; i < n; i++) {
  const a = ra[i], b = rb[i];
  const step = (a || b).step;
  out(`step ${i + 1}: ${j(step)}`);
  if (!a || !b || !a.state || !b.state) {
    out(`  ✗ missing in ${!a || !a.state ? A : B}${a?.error ? " (" + A + ": " + a.error + ")" : ""}${b?.error ? " (" + B + ": " + b.error + ")" : ""}`);
    diffs++;
    continue;
  }
  const sa = a.state, sb = b.state, d = [];
  if (sa.room !== sb.room) d.push(`room ${A}=${sa.room} ${B}=${sb.room}`);
  if (j(sa.inventory) !== j(sb.inventory)) d.push(`inventory ${A}=${j(sa.inventory)} ${B}=${j(sb.inventory)}`);
  if (sa.chooser !== sb.chooser || j(sa.options) !== j(sb.options)) d.push(`chooser ${A}=${j(sa.options)} ${B}=${j(sb.options)}`);
  if (sa.ended !== sb.ended) d.push(`end ${A}=${sa.ended} ${B}=${sb.ended}`);
  // globals that change by themselves or with any click (roaming, action bookkeeping), as in run.js
  const NOISE = /^scumm_(a_|b_|object_|roam_)/;
  const keys = [...new Set([...Object.keys(sa.globals || {}), ...Object.keys(sb.globals || {})])].sort();
  // a global that one engine does not have and the other has as false/0/"" is the same thing
  const empty = (v) => v === undefined || v === null || v === false || v === 0 || v === "";
  // numbers written as text: "80" and "80.0" are the same
  const norm = (v) => (typeof v === "string" ? v.replace(/(\d+)\.0\b/g, "$1") : v);
  for (const k of keys) {
    if (NOISE.test(k)) continue;
    const va = sa.globals[k], vb = sb.globals[k];
    if (j(norm(va)) !== j(norm(vb)) && !(empty(va) && empty(vb)) && String(norm(va)) !== String(norm(vb))) d.push(`global ${k} ${A}=${j(va)} ${B}=${j(vb)}`);
  }
  out(`  room ${sa.room} · inventory ${sa.inventory.join(", ") || "-"} · ${A} ${(a.end - a.start).toFixed(1)} s, ${B} ${(b.end - b.start).toFixed(1)} s`);
  if (d.length) {
    diffs += d.length;
    for (const x of d) out(`  ✗ ${x}`);
  } else out("  = same");
}
out();
out(diffs ? `${diffs} differences` : "No state differences.");
fs.writeFileSync(path.join(dir, "REPORT.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));

// screenshots side by side
const sbs = path.join(dir, "side_by_side");
fs.rmSync(sbs, { recursive: true, force: true });
fs.mkdirSync(sbs);
const W = 640, H = 400;
const scale = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`;
for (let i = 1; i <= n; i++) {
  const name = `${String(i).padStart(2, "0")}.png`;
  const fa = path.join(dir, A, name), fb = path.join(dir, B, name);
  if (!fs.existsSync(fa) || !fs.existsSync(fb)) continue;
  ffmpeg(["-i", fa, "-i", fb, "-filter_complex", `[0]${scale}[a];[1]${scale}[b];[a][b]hstack`, path.join(sbs, name)]);
}

// Where each step ends in a video, read from the marks run.js paints in it (the
// step's number in binary, 5 squares of 12 px in the top left corner): the
// recording drifts from the clock. A step without a mark: its time on the clock
const stepTimes = (video, steps) => {
  const FPS = 25, W = 60, H = 12;
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", video, "-vf", `fps=${FPS},crop=${W}:${H}:0:0,format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 2 ** 31 - 1 });
  const frames = raw.length / (W * H), found = new Map();
  let last = 0, code = -1, run = 0;
  for (let f = 0; f < frames; f++) {
    let c = 0;
    for (let i = 0; i < 5; i++) if (raw[f * W * H + 6 * W + 6 + 12 * i] > 128) c |= 1 << i;
    run = c === code ? run + 1 : 1;
    code = c;
    // (a few frames in a row: the recording can scale a frame down for a moment)
    if (run === 3 && c > last && c <= steps.length) {
      found.set(c, (f - 2) / FPS);
      last = c;
    }
  }
  console.log(`video ${path.basename(path.dirname(video))}: ${found.size}/${steps.length} marks, ${(frames / FPS).toFixed(1)} s`);
  return steps.map((s, i) => Math.min(found.get(s.n) ?? s.end, frames / FPS));
};

// videos side by side, cut by step: each step's piece lasts as the longer of the two
const va = path.join(dir, A, "video.webm"), vb = path.join(dir, B, "video.webm");
if (fs.existsSync(va) && fs.existsSync(vb)) {
  const tmp = path.join(dir, ".pieces");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);
  const list = [];
  const m = Math.min(ra.length, rb.length);
  const ta = stepTimes(va, ra), tb = stepTimes(vb, rb);
  let pa = 0, pb = 0;
  for (let i = 0; i < m; i++) {
    const ea = ta[i], eb = tb[i];
    const da = Math.max(ea - pa, 0.2), db = Math.max(eb - pb, 0.2), len = Math.max(da, db);
    const piece = path.join(tmp, `${String(i + 1).padStart(2, "0")}.mp4`);
    const label = (t) => `drawtext=text='${t} · step ${i + 1}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6`;
    try {
    ffmpeg([
      "-ss", String(pa), "-t", String(da), "-i", va,
      "-ss", String(pb), "-t", String(db), "-i", vb,
      "-filter_complex",
      `[0]fps=25,${scale},tpad=stop_mode=clone:stop_duration=${(len - da + 0.1).toFixed(2)},${label(A)}[a];` +
        `[1]fps=25,${scale},tpad=stop_mode=clone:stop_duration=${(len - db + 0.1).toFixed(2)},${label(B)}[b];[a][b]hstack,trim=duration=${len.toFixed(2)}`,
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", piece,
    ]);
    list.push(`file '${piece}'`);
    } catch (e) {
      console.log(`video: step ${i + 1} couldn't be cut (${e.signal || e.status})`);
    }
    pa = ea;
    pb = eb;
  }
  fs.writeFileSync(path.join(tmp, "list.txt"), list.join("\n"));
  ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"), "-c", "copy", path.join(dir, "side_by_side.mp4")]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`video: ${path.join(dir, "side_by_side.mp4")}`);
}
