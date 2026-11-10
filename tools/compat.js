// Compatibility report: can the JS engine play this exported game? Checked
// without playing it: the exported scenes, resources and ESC scripts against
// what the engine supports (src/support.js, the engine's commands and the
// node properties its code reads). tools/export.js runs it at the end.
//
//   node tools/compat.js out/<game> [-v]
//
// Prints a verdict and a summary, and writes the whole list to
// out/<game>/COMPATIBILITY.txt. -v prints the whole list too.
//
// Verdict:
//   PLAYABLE                nothing missing
//   PLAYABLE WITH GAPS      it runs, but things are not drawn or behave
//                           differently (node types, resources, properties,
//                           events the engine doesn't send); scripts that
//                           don't compile (they don't in Escoria either)
//   NOT PLAYABLE            commands not ported, undefined variables or
//                           objects, scripts on nodes
//                           the engine doesn't run...: the game stops or
//                           does something else where they are used
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const verbose = args.includes("-v");
const gameDir = path.resolve(args.find((a) => !a.startsWith("-")) || "");
if (!fs.existsSync(path.join(gameDir, "game.json"))) {
  console.log("usage: node tools/compat.js out/<game> [-v]");
  process.exit(1);
}

// the little of the browser the engine touches when it starts (like tools/trace.js)
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.Audio = class { constructor(u) { this.src = u; this.paused = true; } play() { return Promise.resolve(); } pause() {} addEventListener() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { fullscreenElement: null, createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
globalThis.fetch = async (u) => ({ ok: true, text: async () => fs.readFileSync(path.join(gameDir, u.slice(2)), "utf8") });

const imp = (f) => import(new URL("file://" + path.join(base, f)).href);
const { GameData } = await imp("src/godot/game_data.js");
const { Escoria } = await imp("src/escoria/escoria.js");
const { API } = await imp("src/escoria/ports.js");
const { compile, resolve } = await imp("src/escoria/ashes/compiler.js");
const { RESERVED_OBJECTS } = await imp("src/escoria/ashes/interpreter.js");
const { translateShader } = await imp("src/godot/shaders.js");
const S = await imp("src/support.js");

const json = JSON.parse(fs.readFileSync(path.join(gameDir, "game.json"), "utf8"));
const game = new GameData("./", json);
game.loadImagesIn = async () => {};
game.loadImage = async () => null;
const esc = new Escoria(game, { log() {}, ui: {} });
let handles = [];
if (json.ports) {
  const ports = await import(new URL("file://" + path.join(gameDir, json.ports)).href);
  handles = ports.handles || [];
  ports.install(esc, API);
}

// ------------------------------------------------------------------ findings

// category -> {error: bool, items: Map(what -> [where])}
const CATEGORIES = [
  // the parser is Escoria's: it doesn't compile there either, and both leave
  // the script without events (ESCCompiler only warns): a bug of the game
  ["esc", false, ".esc scripts that don't compile (not in Escoria either: they have no events)"],
  ["command", true, "Commands not ported to the engine"],
  ["function", true, "Commands or functions that don't exist"],
  ["variable", true, "Variables nobody declares (not even the engine)"],
  ["object", true, "Objects ($id) that are in no scene"],
  ["script", true, "Node scripts the engine doesn't run"],
  ["setting", true, "Escoria settings the engine doesn't support"],
  ["gd", true, "Translated GDScript with gaps (tools/gd2js)"],
  ["node", false, "Node types the engine neither draws nor uses"],
  ["resource", false, "Resources the engine doesn't use"],
  ["prop", false, "Escoria properties the engine doesn't use"],
  ["event", false, "Events the engine never sends"],
  ["partial", false, "Partly supported"],
  ["file", false, "Referenced files that don't exist (in the project)"],
];
const found = new Map(CATEGORIES.map(([k, error, title]) => [k, { error, title, items: new Map() }]));
function add(cat, what, where) {
  const items = found.get(cat).items;
  if (!items.has(what)) items.set(what, []);
  if (where) items.get(what).push(where);
}

const short = (res) => (res || "").replace(/^res:\/\//, "");

// ------------------------------------------------------------------ ESC scripts

const objectIds = new Set(["player", "_music", "_sound", "_speech", "_ambient"]);
for (const doc of Object.values(json.files)) {
  for (const n of doc.nodes || []) if (n.props && typeof n.props.global_id === "string") objectIds.add(n.props.global_id);
}
const BUILTINS = new Set(["print"]);
const SPECIAL_OBJECTS = new Set(["$CURRENT_PLAYER", "$THIS"]); // esc_interpreter.gd: CURRENT_PLAYER_KEYWORD, CURRENT_OBJECT

// every name some script declares (`global x`) or assigns: a global
const compiled = [];
const declared = new Set();
function walk(v, fn) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) return v.forEach((x) => walk(x, fn));
  if (v.kind) fn(v);
  for (const [k, x] of Object.entries(v)) if (k !== "name" && k !== "op" && k !== "paren" && k !== "token") walk(x, fn);
}
for (const [file, src] of Object.entries(json.scripts)) {
  const s = compile(src, file);
  for (const e of s.errors) add("esc", e.replace(/\n/g, "\\n"));
  compiled.push(s);
  for (const ev of s.events.values()) walk(ev, (n) => {
    if (n.kind === "Global" || n.kind === "Assign") declared.add(n.name.lexeme);
  });
}

// globals the game's own code sets (its translated GDScript and its patches):
// set_global("name"), set_global("prefix" + x), set_global("a_%s" % x)
const setByCode = [];
(function scan(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { scan(p); continue; }
    if (!p.endsWith(".js")) continue;
    const src = fs.readFileSync(p, "utf8");
    for (const m of src.matchAll(/set_global\(\s*(?:op\.(add|mod)\(\s*)?"((?:[^"\\]|\\.)*)"/g)) {
      const lit = m[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      setByCode.push(new RegExp(`^${m[1] === "add" ? lit + ".*" : m[1] === "mod" ? lit.replace(/%[sd]/g, ".*") : lit}$`));
    }
    for (const m of src.matchAll(/globals\.(?:set|reserve)\(\s*"((?:[^"\\]|\\.)*)"/g)) declared.add(m[1]);
  }
})(path.join(gameDir, "js_ports"));
const setByGameCode = (name) => setByCode.some((re) => re.test(name));

for (const s of compiled) {
  for (const ev of s.events.values()) {
    const at = (tok) => `${short(s.file)}:${tok.line}`;
    if (S.EVENTS_NOT_SENT[ev.name]) add("event", `:${ev.name} — missing ${S.EVENTS_NOT_SENT[ev.name]}`, short(s.file));
    const locals = new Map();
    resolve(ev, locals);
    const callees = new Set();
    walk(ev, (n) => {
      if (n.kind === "Call" && n.callee.kind === "Variable") {
        callees.add(n.callee);
        const name = n.callee.name.lexeme;
        if (BUILTINS.has(name) || name.startsWith("$")) return;
        const cmd = esc.commands.get(name);
        if (!cmd) add("function", name, at(n.callee.name));
        else if (cmd.missing) add("command", name, at(n.callee.name));
      }
    });
    walk(ev, (n) => {
      if (n.kind !== "Variable" || callees.has(n)) return;
      const name = n.name.lexeme;
      if (name.startsWith("$")) {
        if (!SPECIAL_OBJECTS.has(name.toUpperCase()) && !objectIds.has(name.slice(1))) add("object", name, at(n.name));
        return;
      }
      if (BUILTINS.has(name) || RESERVED_OBJECTS.includes(name) || locals.has(n) || esc.commands.has(name) || esc.globals.has(name) || declared.has(name) || setByGameCode(name)) return;
      add("variable", name, at(n.name));
    });
  }
}

// ------------------------------------------------------------------ scenes and resources

// node properties the engine reads somewhere (props.x / props["x"] in its sources)
const readProps = new Set();
(function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scan(p);
    else if (p.endsWith(".js")) {
      for (const m of fs.readFileSync(p, "utf8").matchAll(/props\??\.([A-Za-z_][A-Za-z_0-9]*)|props\["([^"]+)"\]/g)) readProps.add(m[1] || m[2]);
    }
  }
})(path.join(base, "src"));

const scriptOf = (n) => (n.props && n.props.script) || null;
const supportOfScript = (res) => S.ESCORIA_SCRIPTS[short(res)];
const isEscoriaScene = (res) => /\/esc_[a-z_]+\.gd$/.test(res || "");
// the properties an Escoria script declares (with its base classes), from the
// project's sources; others in a scene (Escoria 3's interact_positions...)
// Godot ignores. null: the sources aren't there (everything is checked)
const classFiles = new Map(); // class_name -> abs path
const declaredCache = new Map();
function declaredProps(res) {
  const src = json.exportedFrom;
  if (!src || !fs.existsSync(src)) return null;
  if (!classFiles.size) {
    const walkGd = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walkGd(p);
        else if (e.name.endsWith(".gd")) {
          const m = /^class_name\s+(\w+)/m.exec(fs.readFileSync(p, "utf8"));
          if (m) classFiles.set(m[1], p);
        }
      }
    };
    const core = path.join(src, "addons");
    if (fs.existsSync(core)) walkGd(core);
  }
  const collect = (file, out, depth = 0) => {
    if (!file || !fs.existsSync(file) || depth > 8) return;
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/^(?:@\w+(?:\([^)]*\))?\s+)*var\s+(\w+)/gm)) out.add(m[1]);
    const ext = /^extends\s+("?)([\w:/.]+)\1/m.exec(text);
    if (ext) collect(ext[2].startsWith("res://") ? path.join(src, ext[2].slice(6)) : classFiles.get(ext[2]), out, depth + 1);
  };
  if (!declaredCache.has(res)) {
    const out = new Set();
    collect(path.join(src, res.slice(6)), out);
    declaredCache.set(res, out.size ? out : null);
  }
  return declaredCache.get(res);
}

for (const [file, doc] of Object.entries(json.files)) {
  const where = short(file);
  // resources: the file itself (.tres) and its sub_resources
  const resources = [];
  if (doc.kind === "resource") resources.push(doc);
  for (const sub of Object.values(doc.sub || {})) resources.push(sub);
  for (const r of resources) {
    if (!r.type) continue;
    if (r.type === "ShaderMaterial") {
      const sh = r.props && r.props.shader;
      if (sh && sh.$res && !(json.files[sh.$res] && json.files[sh.$res].props && json.files[sh.$res].props.code)) {
        add("resource", `ShaderMaterial with its shader in a file (${short(sh.$res)}): the exporter doesn't take it`, where);
      }
      continue;
    }
    if (r.type === "Shader" && r.props && r.props.code) {
      try { translateShader(r.props.code); } catch (e) { add("resource", `Shader that can't be translated: ${e.message}`, where); }
      continue;
    }
    if (S.RESOURCES[r.type] || S.PART_RESOURCES.has(r.type)) continue;
    add("resource", r.type, where);
  }
  if (doc.kind !== "scene" || !doc.nodes) continue;
  // a scene the engine draws itself (menus, dialogs...): only its root script counts
  const rootScript = scriptOf(doc.nodes[0]);
  const whole = rootScript && rootScript.$res && supportOfScript(rootScript.$res) && supportOfScript(rootScript.$res).whole;
  for (const n of whole ? [doc.nodes[0]] : doc.nodes) {
    const label = `${where} (${n.name})`;
    if (n.type && !whole) {
      const sup = S.NODES[n.type];
      if (sup === undefined) { if (!S.HARMLESS_NODES.has(n.type)) add("node", n.type, label); }
      else if (typeof sup === "string") add("partial", `${n.type}: ${sup}`, label);
      if (n.type === "CollisionShape2D") {
        const shape = n.props.shape && n.props.shape.$sub && doc.sub && doc.sub[n.props.shape.$sub];
        if (shape && !["RectangleShape2D", "CircleShape2D", "CapsuleShape2D"].includes(shape.type)) add("partial", `CollisionShape2D with ${shape.type}: the mouse doesn't find it`, label);
      }
    }
    const sc = scriptOf(n);
    if (sc) {
      if (sc.$sub) add("script", "built-in script (in the scene): gd2js doesn't translate it", label);
      else if (sc.$res) {
        const sup = supportOfScript(sc.$res);
        if (sup && sup.partial) add("partial", `${short(sc.$res)}: ${sup.partial}`, label);
        else if (!sup && !handles.includes(sc.$res)) {
          add("script", sc.$res.startsWith("res://addons/") ? `${short(sc.$res)} (Escoria's, not implemented)` : `${short(sc.$res)} (the game's, not translated)`, label);
        }
      }
      // Escoria's node properties the engine never reads
      if (sc.$res && isEscoriaScene(sc.$res)) {
        const scriptName = path.basename(sc.$res);
        const declared = declaredProps(sc.$res);
        for (const p of Object.keys(n.props)) {
          if (declared && !declared.has(p)) continue;
          if (!readProps.has(p) && !S.IGNORED_PROPS.test(p)) add("prop", `${scriptName}: ${p}`, label);
        }
      }
    }
  }
}

// ------------------------------------------------------------------ settings, translated GDScript, missing files

const setting = (k, d) => game.setting(k, d);
for (const m of setting("escoria/ui/dialog_managers", [])) if (!S.DIALOG_MANAGERS.has(m)) add("setting", `escoria/ui/dialog_managers: ${short(m)}`);
const tr = setting("escoria/ui/default_transition", "instant");
if (!S.TRANSITIONS.has(tr)) add("setting", `escoria/ui/default_transition: ${tr}`);

const gdReport = path.join(gameDir, "js_ports", "gd", "REPORT.txt");
if (fs.existsSync(gdReport)) {
  let current = null;
  for (const line of fs.readFileSync(gdReport, "utf8").split("\n")) {
    const m = line.match(/^[△◇✗] (res:\/\/\S+)/);
    if (m) current = m[1];
    else if (/^[✓]/.test(line)) current = null;
    else if (current && /^\s+missing/.test(line)) add("gd", `${short(current)}: ${line.trim()}`);
  }
}
const missing = json.missing || {};
for (const [r, from] of Object.entries(missing)) add("file", short(r), short(from));

// tests (gdUnit and the like) never run in a game: their gaps don't count
for (const [what] of found.get("gd").items) if (/GdUnitTestSuite|\/testing\/|\/tests?\//.test(what)) found.get("gd").items.delete(what);

// ------------------------------------------------------------------ report

const errors = [...found.values()].filter((c) => c.error && c.items.size);
const gaps = [...found.values()].filter((c) => !c.error && c.title !== found.get("partial").title && c.title !== found.get("file").title && c.items.size);
const verdict = errors.length ? "NOT PLAYABLE" : gaps.length ? "PLAYABLE WITH GAPS" : "PLAYABLE";

function section(c, maxWhere = Infinity) {
  const lines = [`${c.error ? "✗" : "△"} ${c.title} (${c.items.size})`];
  const items = [...c.items].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [what, where] of items) {
    const uniq = [...new Set(where)];
    const shown = uniq.slice(0, maxWhere).join(", ");
    const more = uniq.length > maxWhere ? `, and ${uniq.length - maxWhere} more` : "";
    lines.push(`    ${what}${uniq.length ? `  — ${uniq.length > 1 ? `${uniq.length} places: ` : ""}${shown}${more}` : ""}`);
  }
  return lines.join("\n");
}
const used = [...found.values()].filter((c) => c.items.size);
const full = [`Compatibility with the JS engine: ${verdict}`, `(${json.name}, ${new Date().toISOString().slice(0, 10)}; tools/compat.js)`, "", ...used.map((c) => section(c) + "\n")].join("\n");
fs.writeFileSync(path.join(gameDir, "COMPATIBILITY.txt"), full);

if (verbose) console.log(full);
else {
  console.log(`  compatibility with the engine: ${verdict}`);
  for (const c of used) {
    const cut = (w) => (w.length > 70 ? w.slice(0, 67) + "…" : w);
    const names = [...c.items.keys()].map(cut);
    const list = names.slice(0, 6).join(", ") + (names.length > 6 ? `, … (${names.length - 6} more)` : "");
    console.log(`    ${c.error ? "✗" : "△"} ${c.title} (${c.items.size}): ${list}`);
  }
  console.log(`    details: ${path.relative(process.cwd(), path.join(gameDir, "COMPATIBILITY.txt"))}`);
}
process.exit(0);
