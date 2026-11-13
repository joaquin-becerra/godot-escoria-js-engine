// Exports a Godot + Escoria project for the JS engine.
//
//   node tools/export.js <godot project dir> [out dir] [--keep-wav]
//
// Output (default out/<project dir name>/):
//   game.json   settings, every scene/resource as JSON, the ASHES scripts,
//               import options and the uid table
//   res/...     the assets (images, sounds, fonts) at their res:// paths:
//               res://rooms/a/b.png -> res/rooms/a/b.png
//
// Sounds: .wav files are converted to Ogg Vorbis with ffmpeg (if it is
// installed; else they are copied as they are). game.json's `remap` says
// which res:// path is now which file ("res://x.wav" -> "res://x.ogg"); the
// scripts keep naming the .wav. --keep-wav skips the conversion.
//
// Ports (the game's own code in JS, see src/escoria/ports.js), in
// out/<game>/js_ports/index.js, which game.json's `ports` points at: the
// project's GDScript translated by tools/gd2js/translate.js (js_ports/gd/, its
// report in gd/REPORT.txt), plus the JS side of the project's patches to
// Escoria's addons (its js_ports/escoria_patches.js and config.js, if it has
// them).
// The exporter warns about the project's .gd files the ports don't cover
// (their `handles`): the engine ignores those scripts.
//
// At the end it runs tools/compat.js: whether the engine can play the game
// (what it uses that the engine doesn't support), in out/<game>/COMPATIBILITY.txt.
//
// What goes in: every file of the game (outside addons/ and tooling folders),
// plus whatever those files reference inside addons/ (scenes, images, fonts),
// followed recursively. GDScript is never exported: the engine reimplements it.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseTextResource } from "../src/godot/text_resource.js";
import { TRANSITION_FILES } from "../src/escoria/transitions.js";

const FORMAT = 1;
const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const keepWav = args.includes("--keep-wav");
const positional = args.filter((a) => !a.startsWith("--"));
const root = path.resolve(positional[0] || ".");
const name = path.basename(root);
const out = path.resolve(positional[1] || path.join(here, "..", "out", name));
const VORBIS_QUALITY = 3; // ffmpeg -q:a for libvorbis (0..10; ~3 is plenty for game sounds)
const ffmpeg = !keepWav && spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout?.includes("libvorbis");

const SKIP_DIRS = /^(tools|build|nbproject|original|ai_refs)\//; // tooling, never shipped
const ASSET_EXT = new Set(["png", "jpg", "jpeg", "webp", "svg", "wav", "ogg", "mp3", "fnt", "ttf", "otf", "woff", "woff2", "json", "csv", "txt", "translation", "po"]);
const DATA_EXT = new Set(["gdshader", "tscn", "tres", "esc", "ash"]);

// ------------------------------------------------------------------ project files

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const toRes = (abs) => "res://" + path.relative(root, abs).split(path.sep).join("/");
const toAbs = (res) => path.join(root, res.slice(6));
const extOf = (p) => path.extname(p).slice(1).toLowerCase();

const all = walk(root).map(toRes);
const exists = new Set(all);

// uid://... -> res://...
const uids = {};
for (const r of all) {
  if (r.endsWith(".uid")) uids[fs.readFileSync(toAbs(r), "utf8").trim()] = r.slice(0, -4);
  else if (r.endsWith(".import")) {
    const m = /^uid="(uid:\/\/[^"]+)"/m.exec(fs.readFileSync(toAbs(r), "utf8"));
    if (m) uids[m[1]] = r.slice(0, -7);
  }
}
const resolveUid = (s) => s.replace(/uid:\/\/[a-z0-9]+/g, (u) => uids[u] || u);

// ------------------------------------------------------------------ values

// ExtResource("id") -> {"$res": "res://path"}; SubResource("id") -> {"$sub": "id"};
// uid:// strings -> res:// paths. Everything else stays as the parser gives it.
function convert(v, ext) {
  if (Array.isArray(v)) return v.map((x) => convert(x, ext));
  if (typeof v === "string") return v.includes("uid://") ? resolveUid(v) : v;
  if (typeof v === "number" && !Number.isFinite(v)) return { type: "Number", args: [String(v)] }; // inf / nan (not JSON)
  if (!v || typeof v !== "object") return v;
  if (v.type === "ExtResource") {
    const e = ext[v.args[0]];
    if (!e) throw new Error(`unknown ExtResource("${v.args[0]}")`);
    return { $res: e.path };
  }
  if (v.type === "SubResource") return { $sub: v.args[0] };
  if (v.type === "Object") return { type: "Object", class: v.class, props: convert(v.props, ext) };
  if (v.type && Array.isArray(v.args)) return { type: v.type, args: convert(v.args, ext) };
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = convert(x, ext);
  return o;
}

// ------------------------------------------------------------------ scenes and resources

/**
 * .tscn -> {kind: "scene", nodes: [...], sub: {...}, connections: [...]}
 * .tres -> {kind: "resource", type, props, sub: {...}}
 * Nodes keep Godot's order; `parent` is the path relative to the root node
 * ("." for the root's children, absent for the root itself).
 */
function convertDoc(res, doc) {
  const ext = {};
  for (const s of doc.sections) {
    if (s.tag === "ext_resource") {
      let p = s.attrs.path;
      if (!p && s.attrs.uid) p = uids[s.attrs.uid];
      else if (s.attrs.uid && uids[s.attrs.uid] && !exists.has(p)) p = uids[s.attrs.uid]; // moved file
      ext[s.attrs.id] = { type: s.attrs.type, path: p };
    }
  }
  const sub = {};
  const builtinScripts = new Set();
  const nodes = [];
  const connections = [];
  const editable = [];
  let resource = null;
  for (const s of doc.sections) {
    // a GDScript inside the scene: gd2js translates it as "<scene>::<id>" (Godot's
    // name for built-in resources); the nodes point to that, the source stays out
    if (s.tag === "sub_resource" && s.attrs.type === "GDScript") builtinScripts.add(s.attrs.id);
    else if (s.tag === "sub_resource") sub[s.attrs.id] = { type: s.attrs.type, props: convert(s.props, ext) };
    else if (s.tag === "node") {
      const n = { name: s.attrs.name };
      if (s.attrs.type) n.type = s.attrs.type;
      if (s.attrs.parent !== undefined) n.parent = s.attrs.parent;
      if (s.attrs.instance) n.instance = convert(s.attrs.instance, ext).$res;
      if (s.attrs.instance_placeholder) n.placeholder = s.attrs.instance_placeholder;
      if (s.attrs.groups) n.groups = s.attrs.groups;
      if (s.attrs.index !== undefined) n.index = s.attrs.index;
      n.props = convert(s.props, ext);
      if (n.props.script && builtinScripts.has(n.props.script.$sub)) n.props.script = { $res: `${res}::${n.props.script.$sub}` };
      nodes.push(n);
    } else if (s.tag === "connection") connections.push(convert(s.attrs, ext));
    else if (s.tag === "editable") editable.push(s.attrs.path);
    else if (s.tag === "resource") resource = convert(s.props, ext);
  }
  const deps = Object.values(ext).map((e) => e.path).filter(Boolean);
  if (res.endsWith(".tscn")) {
    const o = { kind: "scene", nodes, sub };
    if (connections.length) o.connections = connections;
    if (editable.length) o.editable = editable;
    return { data: o, deps };
  }
  return { data: { kind: "resource", type: doc.header?.attrs.type, props: resource || {}, sub }, deps };
}

// ------------------------------------------------------------------ crawl

// addons/ other than Escoria's (escoria-*) and test frameworks are the game's own
const STOCK_ADDON = /^res:\/\/addons\/(escoria-|gdUnit4\/|gut\/)/;
const shipped = (r) => !STOCK_ADDON.test(r) && !SKIP_DIRS.test(r.slice(6));
const wanted = (r) => DATA_EXT.has(extOf(r)) || ASSET_EXT.has(extOf(r));
const queue = all.filter((r) => shipped(r) && wanted(r) && !r.endsWith("/README.md"));
const included = new Set();
const missing = new Map(); // referenced but not found -> referenced from
const files = {};
const scripts = {};
const assets = [];

function need(r, from) {
  if (!r || typeof r !== "string" || !r.startsWith("res://")) return;
  r = r.replace(/[?#].*$/, "");
  if (extOf(r) === "gd") return;
  if (!exists.has(r)) {
    // a folder (e.g. ui/inventory_items_path) or a file the game builds at runtime
    if (!all.some((a) => a.startsWith(r.endsWith("/") ? r : r + "/"))) missing.set(r, from);
    return;
  }
  if (!included.has(r) && wanted(r)) queue.push(r);
}

// res:// literals inside any text (settings, .esc, GDScript of the game)
const resLiterals = (text) => [...text.matchAll(/res:\/\/[^"'\s)\],:]+/g)].map((m) => m[0]);

const project = parseTextResource(fs.readFileSync(path.join(root, "project.godot"), "utf8"));
const settings = {};
for (const s of project.sections) {
  for (const [k, v] of Object.entries(s.props)) settings[s.tag ? `${s.tag}/${k}` : k] = convert(v, {});
}
for (const r of resLiterals(JSON.stringify(settings))) need(r, "project.godot");
// escoria-dialog-simple's scenes (the dialog type in use and the chooser): the
// engine draws them itself, but a game can give them its own scripts
if (exists.has("res://addons/escoria-dialog-simple/esc_dialog_simple.gd")) {
  const type = settings["escoria/ui/default_dialog_type"] || "floating";
  for (const r of [`res://addons/escoria-dialog-simple/types/${type}.tscn`, "res://addons/escoria-dialog-simple/chooser/simple.tscn"]) if (exists.has(r)) need(r, "escoria-dialog-simple");
}
// the masks of Escoria's transitions (its .material files are binary: src/escoria/transitions.js)
for (const r of TRANSITION_FILES) if (exists.has(r)) need(r, "transitions");
// dialog_simple's avatars: <avatars_path>/<global_id>.tres, loaded by name (avatar.gd)
{
  const dir = String(settings["escoria/dialog_simple/avatars_path"] || "").replace(/\/$/, "");
  if (dir) for (const r of all.filter((r) => r.startsWith(dir + "/") && r.endsWith(".tres"))) need(r, "dialog_simple/avatars_path");
}
// the language flags of Escoria's options menu (options.gd loads flags/<locale>.png)
for (const r of all.filter((r) => r.startsWith("res://addons/escoria-core/ui_library/menus/options/flags/") && r.endsWith(".png"))) need(r, "options");
for (const r of all.filter((r) => shipped(r) && extOf(r) === "gd")) {
  for (const x of resLiterals(fs.readFileSync(toAbs(r), "utf8"))) need(x, r);
}

const parseErrors = [];
while (queue.length) {
  const r = queue.shift();
  if (included.has(r)) continue;
  included.add(r);
  const e = extOf(r);
  if (e === "tscn" || e === "tres") {
    try {
      const { data, deps } = convertDoc(r, parseTextResource(fs.readFileSync(toAbs(r), "utf8")));
      files[r] = data;
      for (const d of deps) need(d, r);
      for (const x of resLiterals(JSON.stringify(data))) need(x, r);
    } catch (err) {
      parseErrors.push(`${r}: ${err.message}`);
    }
  } else if (e === "gdshader") {
    // a Shader resource in its own file: the engine reads it like a .tres
    files[r] = { kind: "resource", type: "Shader", props: { code: fs.readFileSync(toAbs(r), "utf8") }, sub: {} };
  } else if (e === "esc" || e === "ash") {
    const text = fs.readFileSync(toAbs(r), "utf8");
    scripts[r] = text;
    for (const x of resLiterals(text)) need(x, r);
  } else {
    assets.push(r);
    if (e === "fnt") {
      // BMFont: its page images
      const dir = r.slice(0, r.lastIndexOf("/") + 1);
      for (const m of fs.readFileSync(toAbs(r), "utf8").matchAll(/^page id=\d+ file="([^"]+)"/gm)) need(dir + m[1], r);
    }
  }
}

// ------------------------------------------------------------------ import options

// Only what changes how the engine plays an asset (loops, font options...).
// Texture import settings (compression, mipmaps) don't matter in the browser.
const imports = {};
for (const r of assets) {
  if (!exists.has(r + ".import")) continue;
  const doc = parseTextResource(fs.readFileSync(toAbs(r + ".import"), "utf8"));
  const remap = doc.sections.find((s) => s.tag === "remap")?.props || {};
  const params = doc.sections.find((s) => s.tag === "params")?.props || {};
  const entry = { importer: remap.importer };
  if (remap.importer !== "texture") entry.params = convert(params, {});
  imports[r] = entry;
}

// ------------------------------------------------------------------ translations

// CSV translations (importer csv_translation): keys,<locale>,<locale>...
// -> {locale: {key: text}}. With unescape_translations (the default) "\n" in a
// text is a line break, as Godot does.
function parseCsv(text, delimiter = ",") {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
const unescape = (s) => s.replace(/\\(n|t|\\|")/g, (_, c) => ({ n: "\n", t: "\t", "\\": "\\", '"': '"' })[c]);
const translations = {};
for (const r of all.filter((r) => extOf(r) === "csv" && shipped(r) && exists.has(r + ".import"))) {
  const imp = parseTextResource(fs.readFileSync(toAbs(r + ".import"), "utf8"));
  const remap = imp.sections.find((s) => s.tag === "remap")?.props || {};
  if (remap.importer !== "csv_translation") continue;
  const params = imp.sections.find((s) => s.tag === "params")?.props || {};
  const delimiter = [",", ";", "\t"][params.delimiter || 0];
  const rows = parseCsv(fs.readFileSync(toAbs(r), "utf8"), delimiter);
  const head = rows.shift() || [];
  for (let c = 1; c < head.length; c++) {
    const loc = head[c].trim();
    if (!loc || loc.startsWith("_")) continue;
    const table = (translations[loc] ||= {});
    for (const row of rows) {
      if (!row[0] || row[c] === undefined || row[c] === "") continue;
      table[params.unescape_keys ? unescape(row[0]) : row[0]] = params.unescape_translations === false ? row[c] : unescape(row[c]);
    }
  }
}

// ------------------------------------------------------------------ write

if (fs.existsSync(out)) {
  if (fs.readdirSync(out).length && !fs.existsSync(path.join(out, "game.json"))) {
    console.error(`${out} exists and is not an export (no game.json): not touching it`);
    process.exit(1);
  }
  fs.rmSync(out, { recursive: true });
}
let bytes = 0;
let wavBytes = 0, oggBytes = 0;
const remap = {}; // res path in the project -> res path of the exported file
for (const r of assets) {
  let target = r;
  if (ffmpeg && extOf(r) === "wav") target = r.slice(0, -4) + ".ogg";
  const dst = path.join(out, "res", target.slice(6));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (target !== r) {
    const enc = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", toAbs(r), "-c:a", "libvorbis", "-q:a", String(VORBIS_QUALITY), dst], { encoding: "utf8" });
    if (enc.status !== 0) {
      console.log(`  couldn't convert ${r} to ogg: ${enc.stderr.trim()}; the wav goes as is`);
      target = r;
      fs.copyFileSync(toAbs(r), path.join(out, "res", r.slice(6)));
    } else {
      remap[r] = target;
      wavBytes += fs.statSync(toAbs(r)).size;
      oggBytes += fs.statSync(dst).size;
    }
  } else fs.copyFileSync(toAbs(r), dst);
  bytes += fs.statSync(path.join(out, "res", target.slice(6))).size;
}
// ------------------------------------------------------------------ ports

const portsDir = path.join(root, "js_ports");
const outPorts = path.join(out, "js_ports");
let ports = null, handles = [], portsReport = [];
fs.rmSync(outPorts, { recursive: true, force: true });
// the project's GDScript, translated (tools/gd2js)
const tr = spawnSync(process.execPath, [path.join(here, "gd2js", "translate.js"), root, "--out", outPorts], { encoding: "utf8" });
const report = (tr.stdout || "") + (tr.stderr || "");
if (tr.status !== 0) throw new Error(`gd2js/translate.js failed:\n${report}`);
fs.writeFileSync(path.join(outPorts, "gd", "REPORT.txt"), report);
portsReport = report.split("\n").filter((l) => /^completos:|^[△◇✗] |  △ res:\/\/addons/.test(l));
// the JS side of the project's patches to Escoria (and the constants they read)
const extra = ["escoria_patches.js", "config.js"].filter((f) => fs.existsSync(path.join(portsDir, f)));
for (const f of extra) fs.copyFileSync(path.join(portsDir, f), path.join(outPorts, f));
const hasPatches = extra.includes("escoria_patches.js"), hasConfig = extra.includes("config.js");
fs.writeFileSync(path.join(outPorts, "package.json"), '{ "type": "module" }\n');
fs.writeFileSync(path.join(outPorts, "index.js"), [
  "// Generated by tools/export.js: the game's GDScript translated by tools/gd2js",
  "// (gd/)" + (hasPatches ? " and the JS side of its patches to Escoria's addons (escoria_patches.js)." : "."),
  'import { handles as gdHandles, install as installGd } from "./gd/index.js";',
  ...(hasPatches ? ['import * as escoriaPatches from "./escoria_patches.js";'] : []),
  ...(hasConfig ? ['import config from "./config.js";'] : []),
  "",
  "export const handles = gdHandles;",
  ...(hasPatches ? ["export const patches = escoriaPatches.patches;"] : []),
  "",
  "export function install(esc, api) {",
  "  installGd(esc, api);",
  ...(hasPatches ? [`  escoriaPatches.install(esc, api, ${hasConfig ? "config" : "{}"});`] : []),
  "}",
  "",
].join("\n"));
ports = "js_ports/index.js";
try {
  const mod = await import(new URL("file://" + path.join(outPorts, "index.js") + `?t=${Date.now()}`).href);
  handles = mod.handles || [];
} catch (e) {
  console.log(`  couldn't read js_ports/index.js to see what it covers: ${e.message}`);
}
// the project's own scripts (not Escoria's addons, not tooling)
const ownGd = all.filter((r) => r.endsWith(".gd") && shipped(r));
const uncovered = ownGd.filter((r) => !handles.includes(r));

// pictures' sizes, read from their headers: scripts ask a texture's size
// (Texture2D.get_width()) right after load(), before the browser has it
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)]; // PNG
  if (b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: the first SOFn segment
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
    return null;
  }
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (kind === "VP8L") { const n = b.readUInt32LE(21); return [(n & 0x3fff) + 1, ((n >> 14) & 0x3fff) + 1]; }
    if (kind === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  }
  return null;
}
const imageSizes = {};
for (const r of assets) {
  if (!/\.(png|jpe?g|webp)$/i.test(r)) continue;
  try {
    const s = imageSize(toAbs(r));
    if (s) imageSizes[r] = s;
  } catch {}
}

const game = {
  format: FORMAT,
  name: settings["application/config/name"] || name,
  exportedFrom: root,
  settings,
  files,
  scripts,
  imports,
  assets: assets.map((r) => remap[r] || r).sort(),
  remap,
  imageSizes,
  translations,
  ports,
  // GDScript files (paths only): which ESC commands exist in each command
  // directory, and which scripts the engine has to provide in JS
  gdscripts: all.filter((r) => r.endsWith(".gd") && !SKIP_DIRS.test(r.slice(6))).sort(),
  uids,
  // files the project references that don't exist (for tools/compat.js)
  missing: Object.fromEntries(missing),
};
const json = JSON.stringify(game);
fs.writeFileSync(path.join(out, "game.json"), json);

// list of exports for the viewer
const listFile = path.join(path.dirname(out), "exports.json");
let list = [];
try { list = JSON.parse(fs.readFileSync(listFile, "utf8")); } catch {}
list = [...new Set([...list, path.basename(out)])].filter((n) => fs.existsSync(path.join(path.dirname(out), n, "game.json"))).sort();
fs.writeFileSync(listFile, JSON.stringify(list));

const fromAddons = [...included].filter((r) => r.startsWith("res://addons/")).length;
console.log(`${out}`);
console.log(`  game.json: ${(json.length / 1024).toFixed(0)} KB (${Object.keys(files).length} scenes/resources, ${Object.keys(scripts).length} .esc scripts)`);
console.log(`  res/: ${assets.length} assets, ${(bytes / 1024).toFixed(0)} KB`);
if (ports) console.log(`  ports: traducidos (tools/gd2js), ${handles.length} scripts .gd cubiertos`);
for (const l of portsReport) console.log(`    ${l.trim()}`);
if (uncovered.length) {
  console.log(`  the game's own .gd scripts WITHOUT a port (the JS engine ignores them: ${uncovered.length}):`);
  for (const r of uncovered) console.log(`    ${r}`);
}
if (Object.keys(translations).length) console.log(`  traducciones: ${Object.entries(translations).map(([l, t]) => `${l} ${Object.keys(t).length}`).join(", ")}`);
if (Object.keys(remap).length) console.log(`  sonidos: ${Object.keys(remap).length} wav a ogg, ${(wavBytes / 1024).toFixed(0)} KB -> ${(oggBytes / 1024).toFixed(0)} KB`);
else if (!keepWav && assets.some((r) => extOf(r) === "wav")) console.log("  sounds: no ffmpeg with libvorbis, the wavs go as they are");
console.log(`  from addons/: ${fromAddons} files`);
if (missing.size) {
  console.log(`  references to files that don't exist (${missing.size}):`);
  for (const [r, from] of missing) console.log(`    ${r}  (in ${from})`);
}
if (parseErrors.length) {
  console.log(`  read errors (${parseErrors.length}):`);
  for (const e of parseErrors) console.log(`    ${e}`);
  process.exitCode = 1;
}

// can the engine play it? (tools/compat.js: verdict, summary, COMPATIBILITY.txt)
spawnSync(process.execPath, [path.join(here, "compat.js"), out], { stdio: "inherit" });
