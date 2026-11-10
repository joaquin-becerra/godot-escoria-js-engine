// Inventory of what a Godot + Escoria project uses, so we know what the JS
// engine has to support: node types and their properties, resources, Escoria
// settings, ASHES events and commands, and the project's own GDScript files.
//
//   node tools/inventory.js <godot project dir> [out.md] [--ref <escoria demo dir>]
//
// --ref (default ../escoria-demo-game next to this repo, if it exists): lists
// the addon files that differ from that untouched Escoria, i.e. the patches
// the project (or the converter) made to Escoria itself.
//
// Without out.md it writes inventory/<project dir name>.md. A JSON with the
// same data goes next to it (to compare projects later).
import fs from "node:fs";
import path from "node:path";
import { parseTextResource } from "../src/godot/text_resource.js";

const args = process.argv.slice(2);
const refAt = args.indexOf("--ref");
const here = path.dirname(new URL(import.meta.url).pathname);
let refRoot = path.join(here, "..", "..", "escoria-demo-game");
if (refAt >= 0) refRoot = args.splice(refAt, 2)[1];
const root = path.resolve(args[0] || ".");
const name = path.basename(root);
const outMd = args[1] || path.join(here, "..", "inventory", `${name}.md`);

// ------------------------------------------------------------------ files

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue; // .godot, .git
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const res = (p) => "res://" + path.relative(root, p).split(path.sep).join("/");
const files = walk(root).map((p) => ({ abs: p, res: res(p), ext: path.extname(p).slice(1).toLowerCase() }));
const isAddon = (f) => f.res.startsWith("res://addons/");
// leave out tooling that never ships with the game
const isTool = (f) => /^res:\/\/(tools|build|nbproject|original|ai_refs)\//.test(f.res);
const gameFiles = files.filter((f) => !isAddon(f) && !isTool(f));

// uid://... -> res:// path (from the .uid files next to scripts and the
// uid= line of .import files)
const uids = new Map();
for (const f of files) {
  if (f.ext === "uid") uids.set(fs.readFileSync(f.abs, "utf8").trim(), f.res.slice(0, -4));
  else if (f.ext === "import") {
    const m = /^uid="(uid:\/\/[^"]+)"/m.exec(fs.readFileSync(f.abs, "utf8"));
    if (m) uids.set(m[1], f.res.slice(0, -7));
  }
}
const resolveUid = (s) => String(s).replace(/uid:\/\/[a-z0-9]+/g, (u) => uids.get(u) || u);

// ------------------------------------------------------------------ helpers

const count = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);
const sorted = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

function short(v) {
  let s;
  if (v && typeof v === "object" && !Array.isArray(v) && v.type) {
    s = v.type === "Object" ? `Object(${v.class})` : `${v.type}(${v.args.map((a) => JSON.stringify(a)).join(", ")})`;
  } else {
    s = JSON.stringify(v);
  }
  return s.length > 60 ? s.slice(0, 57) + "..." : s;
}

function parse(f) {
  try {
    return parseTextResource(fs.readFileSync(f.abs, "utf8"));
  } catch (e) {
    parseErrors.push(`${f.res}: ${e.message}`);
    return null;
  }
}
const parseErrors = [];

// ------------------------------------------------------------------ project.godot

const project = parseTextResource(fs.readFileSync(path.join(root, "project.godot"), "utf8"));
const settings = {};
for (const s of project.sections) {
  for (const [k, v] of Object.entries(s.props)) settings[s.tag ? `${s.tag}/${k}` : k] = v;
}
const autoloads = Object.entries(settings).filter(([k]) => k.startsWith("autoload/")).map(([k, v]) => [k, resolveUid(v)]);
const escoriaSettings = Object.entries(settings).filter(([k]) => k.startsWith("escoria/"));
const inputActions = Object.keys(settings).filter((k) => k.startsWith("input/")).map((k) => k.slice(6));

// ------------------------------------------------------------------ scenes and resources

const nodeKinds = new Map(); // "Type + script.gd" -> count
const nodeProps = new Map(); // kind -> Map(prop -> {n, example})
const subKinds = new Map(); // sub_resource type -> count
const subProps = new Map();
const extKinds = new Map(); // ext_resource type -> count
const addonRefs = new Map(); // res://addons/... used by the game -> count
const scriptRefs = new Map(); // script path -> Set(files that use it)
const sceneFiles = gameFiles.filter((f) => f.ext === "tscn" || f.ext === "tres");

function addProps(map, kind, props) {
  if (!map.has(kind)) map.set(kind, new Map());
  const m = map.get(kind);
  const seen = new Set(); // tracks/0/path, tracks/1/path... count once per resource
  for (let [k, v] of Object.entries(props)) {
    if (k === "script") continue;
    k = k.replace(/^tracks\/\d+\//, "tracks/*/");
    const e = m.get(k) || { n: 0, example: short(v) };
    if (!seen.has(k)) e.n++;
    seen.add(k);
    m.set(k, e);
  }
}

for (const f of sceneFiles) {
  const doc = parse(f);
  if (!doc) continue;
  const ext = {};
  for (const s of doc.sections) {
    if (s.tag !== "ext_resource") continue;
    ext[s.attrs.id] = s.attrs;
    count(extKinds, s.attrs.type);
    if (String(s.attrs.path).startsWith("res://addons/")) count(addonRefs, s.attrs.path);
    if (s.attrs.type === "Script") {
      if (!scriptRefs.has(s.attrs.path)) scriptRefs.set(s.attrs.path, new Set());
      scriptRefs.get(s.attrs.path).add(f.res);
    }
  }
  const extPath = (v) => (v && v.type === "ExtResource" ? ext[v.args[0]]?.path : null);
  const scriptName = (props) => {
    const p = extPath(props.script);
    return p ? path.basename(p) : props.script ? "(built-in script)" : "";
  };
  for (const s of doc.sections) {
    if (s.tag === "sub_resource") {
      const kind = s.attrs.type + (scriptName(s.props) ? ` + ${scriptName(s.props)}` : "");
      count(subKinds, kind);
      addProps(subProps, kind, s.props);
    } else if (s.tag === "node") {
      let kind;
      if (s.attrs.instance) kind = `instance of ${extPath(s.attrs.instance)}`;
      else if (s.attrs.type) kind = s.attrs.type;
      else kind = "(inherited node, only changes properties)";
      const sc = scriptName(s.props);
      if (sc) kind += ` + ${sc}`;
      count(nodeKinds, kind);
      addProps(nodeProps, kind, s.props);
    } else if (s.tag === "resource" && doc.header) {
      const kind = doc.header.attrs.type + (scriptName(s.props) ? ` + ${scriptName(s.props)}` : "");
      count(subKinds, `${kind} (.tres)`);
      addProps(subProps, `${kind} (.tres)`, s.props);
    }
  }
}

// ------------------------------------------------------------------ ASHES

const escFiles = gameFiles.filter((f) => f.ext === "esc" || f.ext === "ash");
const events = new Map();
const calls = new Map();
const keywords = new Map();
const KEYWORDS = ["if", "elif", "else", "while", "global", "var", "pass", "break", "done", "stop", "return"];
for (const f of escFiles) {
  const text = fs.readFileSync(f.abs, "utf8");
  for (const line of text.split("\n")) {
    const t = line.replace(/#.*$/, "").trim();
    if (!t) continue;
    let m;
    if ((m = /^:(\w+)/.exec(t))) count(events, m[1]);
    for (const c of t.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) count(calls, c[1]);
    if ((m = /^([a-z_]+)\b/.exec(t)) && KEYWORDS.includes(m[1])) count(keywords, m[1]);
  }
}
// where each command comes from: Escoria's own folder or the project's
const coreCommands = new Set(
  files.filter((f) => /^res:\/\/addons\/escoria-core\/game\/core-scripts\/esc\/commands\/[^/]+\.gd$/.test(f.res)).map((f) => path.basename(f.res, ".gd")),
);
const ownCommands = new Set(gameFiles.filter((f) => f.ext === "gd" && f.res.startsWith("res://commands/")).map((f) => path.basename(f.res, ".gd")));
const origin = (c) => (coreCommands.has(c) ? "Escoria" : ownCommands.has(c) ? "own" : "?");

// ------------------------------------------------------------------ own GDScript

const autoloadPaths = autoloads.map(([, v]) => String(v).replace(/^\*/, ""));
const textFiles = files
  .filter((f) => ["gd", "tscn", "tres", "godot", "cfg"].includes(f.ext) && !isTool(f))
  .map((f) => ({ res: f.res, text: fs.readFileSync(f.abs, "utf8") }));
const ownScripts = gameFiles
  .filter((f) => f.ext === "gd")
  .map((f) => {
    const src = fs.readFileSync(f.abs, "utf8");
    const lines = src.split("\n").length;
    const used = new Set();
    if (scriptRefs.has(f.res)) for (const r of scriptRefs.get(f.res)) used.add(r);
    if (autoloadPaths.includes(f.res)) used.add("autoload");
    if (f.res.startsWith("res://commands/")) used.add("ASHES command");
    const cls = /^class_name\s+(\w+)/m.exec(src)?.[1];
    const uid = [...uids].find(([, p]) => p === f.res)?.[0];
    for (const o of textFiles) {
      if (o.res === f.res || used.has(o.res)) continue;
      if (o.text.includes(`"${f.res}"`) || (uid && o.text.includes(uid)) || (cls && new RegExp(`\\b${cls}\\b`).test(o.text))) used.add(o.res);
    }
    const ext = /^extends\s+(\S+)/m.exec(src)?.[1]?.replace(/"/g, "") || "";
    return { res: f.res, lines, extends: ext, used: [...used] };
  });

// ------------------------------------------------------------------ patched addons

const patched = [];
const addedToAddons = [];
if (fs.existsSync(refRoot) && path.resolve(refRoot) !== root) {
  for (const f of files.filter((f) => isAddon(f) && ["gd", "tscn", "tres", "cfg"].includes(f.ext))) {
    const ref = path.join(refRoot, f.res.slice(6));
    if (!fs.existsSync(ref)) {
      addedToAddons.push(f.res);
      continue;
    }
    const a = fs.readFileSync(f.abs, "utf8").replace(/\r/g, "");
    const b = fs.readFileSync(ref, "utf8").replace(/\r/g, "");
    if (a === b) continue;
    // changed lines, roughly (multiset difference)
    const bl = new Map();
    for (const l of b.split("\n")) count(bl, l);
    let changed = 0;
    for (const l of a.split("\n")) {
      if (bl.get(l) > 0) bl.set(l, bl.get(l) - 1);
      else changed++;
    }
    patched.push([f.res, changed]);
  }
}

// ------------------------------------------------------------------ files by type

const byExt = new Map();
const bytesByExt = new Map();
for (const f of gameFiles) {
  count(byExt, f.ext || "(no extension)");
  count(bytesByExt, f.ext || "(no extension)", fs.statSync(f.abs).size);
}

// ------------------------------------------------------------------ report

const L = [];
const table = (head, rows) => {
  L.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
  for (const r of rows) L.push(`| ${r.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`);
  L.push("");
};
const kb = (n) => (n / 1024).toFixed(0) + " KB";

L.push(`# Inventory: ${name}`, "");
L.push(`Generated by \`tools/inventory.js\` from \`${root}\`. Without \`addons/\` or tools (tools, build...).`, "");

L.push("## Project", "");
table(["Setting", "Value"], [
  ["Name", short(settings["application/config/name"])],
  ["Main scene", short(settings["application/run/main_scene"])],
  ["Window", `${settings["display/window/size/viewport_width"] ?? "?"} × ${settings["display/window/size/viewport_height"] ?? "?"}`],
  ["Stretch", short(settings["display/window/stretch/mode"] ?? "(no)")],
  ["Plugins", short(settings["editor_plugins/enabled"])],
]);
L.push("Autoloads:", "");
table(["Name", "Script / scene"], autoloads.map(([k, v]) => [k.slice(9), short(v)]));
L.push(`The game's own input actions: ${inputActions.map((a) => `\`${a}\``).join(", ") || "(none)"}`, "");

L.push("## Escoria settings", "");
table(["Setting", "Value"], escoriaSettings.map(([k, v]) => [k.slice(8), short(v)]));

L.push("## Game files", "");
table(["Type", "Count", "Size"], sorted(byExt).map(([e, n]) => [e, n, kb(bytesByExt.get(e))]));

L.push("## Nodes", "");
L.push("Node type (or instanced scene) + script, with the properties it uses and an example value.", "");
table(["Node", "Count"], sorted(nodeKinds));
for (const [kind] of sorted(nodeKinds)) {
  const props = nodeProps.get(kind);
  if (!props || !props.size) continue;
  L.push(`### ${kind}`, "");
  table(["Property", "Times", "Example"], [...props.entries()].sort((a, b) => b[1].n - a[1].n).map(([p, e]) => [p, e.n, `\`${e.example}\``]));
}

L.push("## Internal resources (sub_resource and .tres)", "");
table(["Type", "Count"], sorted(subKinds));
for (const [kind] of sorted(subKinds)) {
  const props = subProps.get(kind);
  if (!props || !props.size) continue;
  L.push(`### ${kind}`, "");
  table(["Property", "Times", "Example"], [...props.entries()].sort((a, b) => b[1].n - a[1].n).map(([p, e]) => [p, e.n, `\`${e.example}\``]));
}

L.push("## External resources (ext_resource) by type", "");
table(["Type", "References"], sorted(extKinds));

L.push("## Parts of the addons the game uses directly", "");
table(["Resource", "References"], sorted(addonRefs));

L.push("## ASHES", "");
L.push(`${escFiles.length} \`.esc\` files.`, "");
L.push("Events:", "");
table(["Event", "Times"], sorted(events));
L.push("Commands and functions called (origin: Escoria = `escoria-core/.../commands`, own = `res://commands/`, ? = something else, e.g. expression functions):", "");
table(["Command", "Times", "Origin"], sorted(calls).map(([c, n]) => [c, n, origin(c)]));
L.push("Keywords:", "");
table(["Word", "Times"], sorted(keywords));

L.push("## The game's own GDScript", "");
L.push("The exporter translates them to JS with `tools/gd2js`.", "");
table(["Script", "Lines", "Extends", "Used by"], ownScripts.map((s) => [s.res, s.lines, s.extends, s.used.join(", ") || "(nobody)"]));

if (patched.length || addedToAddons.length) {
  L.push("## Changes to Escoria's addons", "");
  L.push(`Files in \`addons/\` that differ from \`${path.resolve(refRoot)}\`: the engine has to copy that behaviour too.`, "");
  table(["File", "New or changed lines"], patched);
  if (addedToAddons.length) {
    L.push("Files that aren't in the reference:", "");
    for (const a of addedToAddons) L.push(`- ${a}`);
    L.push("");
  }
}

if (parseErrors.length) {
  L.push("## Read errors", "");
  for (const e of parseErrors) L.push(`- ${e}`);
  L.push("");
}

fs.mkdirSync(path.dirname(outMd), { recursive: true });
fs.writeFileSync(outMd, L.join("\n"));
const json = {
  project: name,
  autoloads: Object.fromEntries(autoloads.map(([k, v]) => [k.slice(9), v])),
  escoriaSettings: Object.fromEntries(escoriaSettings),
  nodes: Object.fromEntries([...nodeProps].map(([k, m]) => [k, Object.fromEntries([...m].map(([p, e]) => [p, e.n]))])),
  nodeCounts: Object.fromEntries(nodeKinds),
  subResources: Object.fromEntries([...subProps].map(([k, m]) => [k, Object.fromEntries([...m].map(([p, e]) => [p, e.n]))])),
  extResources: Object.fromEntries(extKinds),
  addonRefs: Object.fromEntries(addonRefs),
  events: Object.fromEntries(events),
  calls: Object.fromEntries(calls),
  keywords: Object.fromEntries(keywords),
  ownScripts,
  patchedAddons: Object.fromEntries(patched),
  addedToAddons,
  parseErrors,
};
fs.writeFileSync(outMd.replace(/\.md$/, ".json"), JSON.stringify(json, null, 1));
console.log(`${outMd}: ${sceneFiles.length} scenes/resources, ${escFiles.length} .esc, ${ownScripts.length} own .gd, ${parseErrors.length} read errors`);
