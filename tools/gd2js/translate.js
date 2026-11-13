// Translates a Godot project's own GDScript into JS ports for the engine.
//
//   node tools/gd2js/translate.js <godot project dir> [--out <dir>] [--escoria <stock dir>]
//
// --out: where the ports go (default out/<project dir name>/js_ports/, where
// tools/export.js puts them; the exporter runs this and writes their index.js).
// --escoria: a project with Escoria as it comes (default ../escoria-demo-game):
// the functions of the addons this project changed are listed, and whether
// the project brings their JS side (the `patches` its
// js_ports/escoria_patches.js exports: "<script>:<function>").
//
// For every .gd of the project (not addons/, not tooling folders):
//   - <out>/gd/<path>.js     the translated module (tools/gd2js/emit.js)
//   - <out>/gd/index.js      `handles` + install(esc, api): commands
//                            (scripts in a command directory), scripts of
//                            scene nodes, autoloads, class_name classes
// and a report of the Godot / Escoria APIs each script uses that the bridge
// (src/godot/bridge) doesn't have yet.
import fs from "node:fs";
import path from "node:path";
import { parse } from "./parser.js";
import { emitModule } from "./emit.js";
import { apiUsage } from "./api_usage.js";
import { parseTextResource } from "../../src/godot/text_resource.js";
import { SUPPORTED } from "../../src/godot/bridge/index.js";

const root = path.resolve(process.argv[2] || ".");
const outArg = process.argv.indexOf("--out");
const portsDir = outArg > 0
  ? path.resolve(process.argv[outArg + 1])
  : path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "out", path.basename(root), "js_ports");
// addons/ other than Escoria's own (escoria-*) and test frameworks are the
// game's code (e.g. Superfluous Returnz's sr-ui-simplemouse): translated too
const TOOLING = /^(addons\/(escoria-[^/]*|gdUnit4|gut)|tools|build|nbproject|original|ai_refs|js_ports)\//;

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const all = walk(root);
const res = (abs) => "res://" + path.relative(root, abs).split(path.sep).join("/");

// ---------------------------------------------------------------- what the project has

const settings = {};
for (const s of parseTextResource(fs.readFileSync(path.join(root, "project.godot"), "utf8")).sections) {
  for (const [k, v] of Object.entries(s.props)) settings[s.tag ? `${s.tag}/${k}` : k] = v;
}
const uidMap = new Map();
for (const f of all.filter((f) => f.endsWith(".uid"))) uidMap.set(fs.readFileSync(f, "utf8").trim(), res(f).slice(0, -4));
const autoloads = new Map(); // name -> res path
for (const [k, v] of Object.entries(settings)) {
  if (!k.startsWith("autoload/")) continue;
  let p = String(v).replace(/^\*/, "");
  if (p.startsWith("uid://")) p = uidMap.get(p) || p;
  autoloads.set(k.slice(9), p);
}
const commandDirs = (settings["escoria/main/command_directories"] || []).map((d) => d.replace(/\/?$/, "/"));
// scripts attached to scene nodes (also in the addons' scenes: a game can give
// them its own scripts, as the converter does with dialog-simple's)
const sceneScripts = new Set();
for (const f of all.filter((f) => f.endsWith(".tscn") && (!TOOLING.test(res(f).slice(6)) || res(f).startsWith("res://addons/")))) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/path="(res:\/\/[^"]+\.gd)"/g)) sceneScripts.add(m[1]);
}

const todo = all.filter((f) => f.endsWith(".gd") && !TOOLING.test(res(f).slice(6)));
// GDScripts inside scenes ([sub_resource type="GDScript"] script/source): "<scene>::<id>"
const builtin = new Map(); // res -> source
for (const f of all.filter((f) => f.endsWith(".tscn") && !TOOLING.test(res(f).slice(6)))) {
  const text = fs.readFileSync(f, "utf8");
  if (!text.includes('type="GDScript"')) continue;
  for (const sec of parseTextResource(text).sections) {
    if (sec.tag !== "sub_resource" || sec.attrs.type !== "GDScript" || typeof sec.props["script/source"] !== "string") continue;
    const r = `${res(f)}::${sec.attrs.id}`;
    builtin.set(r, sec.props["script/source"]);
    sceneScripts.add(r);
  }
}
const resOf = (f) => (builtin.has(f) ? f : res(f));

// ---------------------------------------------------------------- translate

const outDir = path.join(portsDir, "gd");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const sup = SUPPORTED();
const autoloadNames = new Set(autoloads.keys());
const entries = [];
const reports = [];
const classNames = new Set();
const parsed = [];
for (const f of [...todo, ...builtin.keys()]) {
  try {
    parsed.push([f, parse(builtin.has(f) ? builtin.get(f) : fs.readFileSync(f, "utf8"))]);
  } catch (e) {
    reports.push({ file: resOf(f), error: e.message });
  }
}
// what the project's own scripts define (they are translated too): their
// members count as supported when another script uses them
const ownMembers = new Set();
const collectMembers = (members) => {
  for (const m of members) {
    if (["Func", "Var", "Const", "Signal", "Enum"].includes(m.k) && m.name) ownMembers.add(m.name);
    // an enum's values (named enums too: State.IDLE is read as a member of State)
    if (m.k === "Enum") for (const v of m.values) ownMembers.add(Array.isArray(v) ? v[0] : v.name ?? v);
    if (m.k === "Class") collectMembers(m.members);
  }
};
// the @export vars of Escoria's node scripts (esc_item.gd...): they are props of
// the scene's nodes, which the bridge's nodes read and write
const coreDir = path.join(root, "addons", "escoria-core", "game", "core-scripts");
if (fs.existsSync(coreDir)) {
  for (const f of walk(coreDir).filter((f) => f.endsWith(".gd"))) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/^@export[^\n]*?\bvar\s+([A-Za-z_]\w*)/gm)) ownMembers.add(m[1]);
  }
}
for (const [, ast] of parsed) {
  if (ast.classname) classNames.add(ast.classname);
  collectMembers(ast.members);
}

for (const [f, ast] of parsed) {
  const r = resOf(f);
  const className = ast.classname || path.basename(r.replace("::", "_"), ".gd").replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  const { code, notes } = emitModule(ast, { source: r, className, autoloads: autoloadNames });
  const rel = r.slice(6).replace(/\.gd$/, "").replace("::", "__") + ".js";
  const dst = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, code);
  // kind
  let kind = "class";
  if (ast.extends === "ESCBaseCommand" && commandDirs.some((d) => r.startsWith(d))) kind = "command";
  else if ([...autoloads.values()].includes(r)) kind = "autoload";
  else if (sceneScripts.has(r)) kind = "node";
  entries.push({ res: r, rel, kind, className, classname: ast.classname, extends: ast.extends, autoload: [...autoloads].find(([, p]) => p === r)?.[0] });
  // missing APIs
  const u = apiUsage(ast, autoloadNames);
  const missing = [];
  const last = (s) => s.replace(/\(\)$/, "").split(".").pop();
  for (const [g, m] of Object.entries(u.groups)) {
    for (const key of m.keys()) {
      let ok = true;
      const k = key.replace(/\(\)/g, "").replace(/ \(extends\)$/, "");
      if (g === "globals") ok = sup.globals.has(k);
      else if (g === "classes" && /^res:\/\//.test(k)) ok = sup.scripts.has(k) || parsed.some(([f]) => resOf(f) === k); // extends "res://x.gd"
      else if (g === "classes") {
        const c = k.split(".")[0];
        const member = k.split(".")[1] === "new" ? null : k.split(".")[1]; // Class.new()
        ok = (sup.classes.has(c) || /Command$/.test(c) || classNames.has(c) || c === "preload" || c === ast.classname) && (!member || !classNames.has(c) || ownMembers.has(member.replace(/\(.*$/, "")));
      } else if (g === "escoria") ok = [...sup.escoria].some((s) => k === s || k.startsWith(s + ".") || s.startsWith(k + "."));
      else if (g === "singletons") ok = sup.singletons.has(k.split(".")[0]) || autoloadNames.has(k.split(".")[0]);
      else if (g === "nodes" && /^\$[^.]*$/.test(k)) ok = true; // $path / $%unique: get_node
      else if (last(k) === "new") ok = true; // X.new() on a class held in a variable / const
      else if (g === "inherited" || g === "nodes" || g === "members") ok = sup.node.has(last(k)) || sup.builtin.has(last(k)) || ownMembers.has(last(k));
      if (!ok) missing.push(`${g}: ${key}`);
    }
  }
  // the project's classes (class_name) it uses: it works only if they do
  const uses = [...classNames].filter((c) => c !== ast.classname && [...(u.groups.classes || new Map()).keys()].some((k) => k === c || k.startsWith(c + ".") || k.startsWith(c + "(")));
  reports.push({ file: r, kind, notes, missing, classname: ast.classname, uses });
}
// a script is complete when nothing is missing in it nor in the classes it uses
const byClass = new Map(reports.filter((r) => r.classname).map((r) => [r.classname, r]));
const complete = (r, seen = new Set()) => {
  if (r.error || r.missing.length || r.notes.length) return false;
  if (seen.has(r)) return true;
  seen.add(r);
  return r.uses.every((c) => !byClass.has(c) || complete(byClass.get(c), seen));
};
for (const r of reports) if (!r.error) r.waits = r.uses.filter((c) => byClass.has(c) && !complete(byClass.get(c)));

// ---------------------------------------------------------------- index

const lines = [
  "// Generated by tools/gd2js/translate.js: the project's GDScript translated",
  "// to JS (over the engine's GDScript bridge). Don't edit: translate again.",
];
// a script's base (extends "res://x.gd" or a class_name of the game) is made first
{
  const byRes = new Map(entries.map((e) => [e.res, e]));
  const byName = new Map(entries.filter((e) => e.classname).map((e) => [e.classname, e]));
  const parentOf = (e) => byRes.get(e.extends) || byName.get(e.extends) || null;
  const sorted = [], seen = new Set();
  const visit = (e) => {
    if (seen.has(e)) return;
    seen.add(e);
    const p = parentOf(e);
    if (p) visit(p);
    // and the game's classes it uses (a constant can need one while loading,
    // e.g. SosageLabel.Kind.PLAIN); cycles are left in the order they come
    let js = "";
    try {
      js = fs.readFileSync(path.join(portsDir, "gd", e.rel), "utf8");
    } catch {}
    for (const m of js.matchAll(/gd\.cls\("([A-Za-z_0-9]+)"\)/g)) if (byName.has(m[1])) visit(byName.get(m[1]));
    // and the scripts it preloads (const X = preload("res://x.gd"))
    for (const m of js.matchAll(/gd\.preload\("(res:\/\/[^"]+\.gd)"\)/g)) if (byRes.has(m[1])) visit(byRes.get(m[1]));
    sorted.push(e);
  };
  entries.forEach(visit);
  entries.splice(0, entries.length, ...sorted);
}
entries.forEach((e, i) => lines.push(`import m${i} from "./${e.rel}";`));
lines.push("", `export const handles = ${JSON.stringify(entries.map((e) => e.res), null, 1)};`, "");
lines.push("export function install(esc, api) {", "  const gd = api.bridge(esc);", "  const cls = {};");
// classes first (they can be used by the rest), then the others
entries.forEach((e, i) => lines.push(`  cls[${JSON.stringify(e.res)}] = m${i}(gd); gd.registerScript(${JSON.stringify(e.res)}, cls[${JSON.stringify(e.res)}]);${e.classname ? ` gd.registerClass(${JSON.stringify(e.classname)}, cls[${JSON.stringify(e.res)}]);` : ""}`));
for (const e of entries) {
  const C = `cls[${JSON.stringify(e.res)}]`;
  if (e.kind === "command") lines.push(`  esc.addCommands({ ${JSON.stringify(e.res)}: gd.commandImpl(${C}) });`);
  else if (e.kind === "node") lines.push(`  esc.nodeScripts[${JSON.stringify(e.res)}] = (esc, node) => gd.attachScript(${C}, node);`);
  else if (e.kind === "autoload") lines.push(`  gd.addAutoload(${JSON.stringify(e.autoload)}, ${C});`);
}
lines.push("}", "");
fs.writeFileSync(path.join(outDir, "index.js"), lines.join("\n"));
fs.writeFileSync(path.join(portsDir, "package.json"), '{ "type": "module" }\n');

// ---------------------------------------------------------------- Escoria's addons, patched

// the top-level functions of a script, by name -> their text (normalized); "(class)" for the rest
function functionsOf(text) {
  const out = new Map();
  const lines = text.replace(/\r/g, "").split("\n");
  let name = "(class)", buf = [];
  const flush = () => {
    const body = buf.map((l) => l.replace(/#.*$/, "").trimEnd()).filter((l) => l.trim()).join("\n");
    out.set(name, (out.get(name) || "") + body);
  };
  for (const l of lines) {
    const m = /^(?:static\s+)?func\s+(\w+)/.exec(l);
    if (m) {
      flush();
      name = m[1];
      buf = [l];
    } else if (/^\S/.test(l) && !/^[#)\]]/.test(l) && name !== "(class)") {
      flush();
      name = "(class)";
      buf = [l];
    } else buf.push(l);
  }
  flush();
  return out;
}
const escArg = process.argv.indexOf("--escoria");
const stockRoot = path.resolve(escArg > 0 ? process.argv[escArg + 1] : path.join(root, "..", "escoria-demo-game"));
const patched = []; // [{script, functions: [...]}]
if (fs.existsSync(path.join(stockRoot, "addons")) && stockRoot !== root) {
  for (const f of all.filter((f) => f.endsWith(".gd") && res(f).startsWith("res://addons/"))) {
    const stock = path.join(stockRoot, path.relative(root, f));
    if (!fs.existsSync(stock)) continue;
    const a = fs.readFileSync(stock, "utf8"), b = fs.readFileSync(f, "utf8");
    if (a === b) continue;
    const fa = functionsOf(a), fb = functionsOf(b);
    const changed = [...new Set([...fa.keys(), ...fb.keys()])].filter((k) => fa.get(k) !== fb.get(k));
    if (changed.length) patched.push({ script: res(f), functions: changed });
  }
}
// the ones the project brings the JS side of (its js_ports/escoria_patches.js `patches`)
let coveredPatches = [];
const patchesFile = path.join(root, "js_ports", "escoria_patches.js");
if (fs.existsSync(patchesFile)) {
  try {
    coveredPatches = (await import("file://" + patchesFile + `?p=${Date.now()}`)).patches || [];
  } catch (e) {
    console.log(`couldn't read js_ports/escoria_patches.js: ${e.message}`);
  }
}

// ---------------------------------------------------------------- report

console.log(`${entries.length} scripts translated to ${path.relative(process.cwd(), outDir)}/`);
const ok = reports.filter((r) => !r.error && !r.missing.length && !r.notes.length);
console.log(`complete: ${ok.filter((r) => !r.waits.length).length}, complete but waiting for another game class (◇): ${ok.filter((r) => r.waits.length).length}, with gaps (△): ${reports.length - ok.length}`);
for (const r of reports) {
  if (r.error) {
    console.log(`\n✗ ${r.file}: couldn't read: ${r.error}`);
    continue;
  }
  const bad = r.missing.length + r.notes.length;
  console.log(`\n${bad ? "△" : r.waits.length ? "◇" : "✓"} ${r.file} (${r.kind})`);
  if (r.waits.length) console.log(`    uses game classes that aren't complete yet: ${r.waits.join(", ")}`);
  for (const n of r.notes) console.log(`    not translated: ${n}`);
  for (const m of r.missing) console.log(`    missing in the bridge: ${m}`);
}

if (patched.length) {
  console.log(`\nModified Escoria (compared with ${path.relative(process.cwd(), stockRoot)}):`);
  for (const p of patched) {
    for (const fn of p.functions) {
      const key = `${p.script}:${fn}`;
      const ok = coveredPatches.includes(key);
      console.log(`  ${ok ? "✓" : "△"} ${key}${ok ? "" : "  <- no JS side in js_ports/escoria_patches.js"}`);
    }
  }
}
