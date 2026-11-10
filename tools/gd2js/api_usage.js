// What a GDScript file uses from outside itself (Godot, Escoria, other
// scripts): the APIs the JS engine has to provide for a translation to work.
//
//   node tools/gd2js/api_usage.js <file.gd | dir>...
//
// Groups:
//   globals   functions and constants of @GlobalScope / @GDScript (sin, randi, str, TYPE_INT...)
//   classes   class names (Vector2, Timer, ESCObject, SayCommand...) and what is used from them
//   escoria   chains from the `escoria` singleton (escoria.object_manager.get_object)
//   singletons other autoloads / engine singletons (Input, Engine, ProjectSettings, game autoloads)
//   inherited methods and properties of its base class used on itself (show, queue_free, position)
//   nodes     $paths and what is done with them
//   members   properties / methods used on other values (text, set_state, active...)
import fs from "node:fs";
import path from "node:path";
import { parse } from "./parser.js";

const GLOBAL_FUNCS = new Set(("abs absf absi acos acosh angle_difference asin asinh atan atan2 atanh bezier_derivative bezier_interpolate bytes_to_var " +
  "ceil ceilf ceili clamp clampf clampi cos cosh cubic_interpolate db_to_linear deg_to_rad ease error_string exp floor floorf floori fmod fposmod hash " +
  "instance_from_id inverse_lerp is_equal_approx is_finite is_inf is_instance_id_valid is_instance_valid is_nan is_same is_zero_approx lerp lerp_angle lerpf " +
  "linear_to_db log max maxf maxi min minf mini move_toward nearest_po2 pingpong posmod pow print print_rich print_verbose printerr printraw prints printt " +
  "push_error push_warning rad_to_deg rand_from_seed randf randf_range randfn randi randi_range randomize remap rid_allocate_id rid_from_int64 rotate_toward " +
  "round roundf roundi seed sign signf signi sin sinh smoothstep snapped snappedf snappedi sqrt step_decimals str str_to_var tan tanh type_convert type_string " +
  "typeof var_to_bytes var_to_str weakref wrap wrapf wrapi Color8 assert char convert dict_to_inst get_stack inst_to_dict is_instance_of len load " +
  "print_debug print_stack range type_exists bool int float String StringName NodePath Array Dictionary Callable Signal").split(" "));
const GLOBAL_CONSTS = /^(CONNECT_\w+|PI|TAU|INF|NAN|TYPE_\w+|KEY_\w+|MOUSE_\w+|JOY_\w+|OK|ERR_\w+|FAILED|HORIZONTAL_\w+|VERTICAL_\w+|SIDE_\w+|CORNER_\w+|PROPERTY_\w+|METHOD_\w+|OP_\w+|INLINE_\w+|CLOCKWISE|COUNTERCLOCKWISE|HORIZONTAL|VERTICAL)$/;
const SINGLETONS = new Set("Engine Input OS ProjectSettings ResourceLoader ResourceSaver ClassDB DisplayServer RenderingServer AudioServer TranslationServer Time JSON IP Geometry2D NavigationServer2D PhysicsServer2D ThemeDB EditorInterface Performance Marshalls".split(" "));

/** Usage of one parsed script: {extends, groups: {group: Map(name -> count)}} */
export function apiUsage(ast, autoloads = new Set()) {
  const groups = { globals: new Map(), classes: new Map(), escoria: new Map(), singletons: new Map(), inherited: new Map(), nodes: new Map(), members: new Map() };
  const add = (g, k) => groups[g].set(k, (groups[g].get(k) || 0) + 1);

  // names the script defines at class level
  const own = new Set();
  const collectOwn = (members) => {
    for (const m of members) {
      if (m.name) own.add(m.name);
      if (m.k === "Enum") for (const [v] of m.values) own.add(v);
    }
  };
  collectOwn(ast.members);
  for (const m of ast.members) if (m.k === "Class") own.add(m.name);

  // attribute chain of an expression: escoria.object_manager.get_object -> ["escoria", "object_manager", "get_object"]
  const chain = (e) => {
    if (e.k === "Name") return [e.v];
    if (e.k === "Attr") {
      const c = chain(e.obj);
      return c ? [...c, e.name] : null;
    }
    return null;
  };

  const visitFunc = (params, body, scope) => {
    const s = new Set(scope);
    for (const p of params) s.add(p.name);
    stmts(body, s);
  };

  const stmts = (list, scope) => {
    for (const st of list) stmt(st, scope);
  };

  const stmt = (s, scope) => {
    switch (s.k) {
      case "Expr": return expr(s.e, scope);
      case "VarDecl":
      case "ConstDecl":
        if (s.value) expr(s.value, scope);
        if (s.type) typeUse(s.type);
        scope.add(s.name);
        return;
      case "If":
        expr(s.cond, scope);
        stmts(s.body, new Set(scope));
        for (const b of s.elifs) {
          expr(b.cond, scope);
          stmts(b.body, new Set(scope));
        }
        if (s.else) stmts(s.else, new Set(scope));
        return;
      case "For": {
        expr(s.iter, scope);
        const sc = new Set(scope);
        sc.add(s.var);
        return stmts(s.body, sc);
      }
      case "While":
        expr(s.cond, scope);
        return stmts(s.body, new Set(scope));
      case "Match":
        expr(s.value, scope);
        for (const b of s.branches) {
          const sc = new Set(scope);
          for (const pt of b.patterns) pattern(pt, sc);
          if (b.guard) expr(b.guard, sc);
          stmts(b.body, sc);
        }
        return;
      case "Return":
        if (s.e) expr(s.e, scope);
        return;
      case "Assert":
        s.args.forEach((a) => expr(a, scope));
        return;
      case "Block":
        return stmts(s.body, scope);
    }
  };

  const pattern = (p, scope) => {
    if (p.k === "Bind") scope.add(p.name);
    else if (p.k === "Value") expr(p.e, scope);
    else if (p.k === "ArrayPattern") p.items.forEach((x) => pattern(x, scope));
    else if (p.k === "DictPattern") for (const [k, v] of p.pairs) {
      if (k && k.k !== "Rest") expr(k, scope);
      if (v) pattern(v, scope);
    }
  };

  const typeUse = (t) => {
    const base = t.replace(/\[.*$/, "").split(".")[0];
    if (!own.has(base) && !["int", "float", "bool", "void", "Variant"].includes(base)) add("classes", base);
  };

  // a name that isn't local or the script's own
  const external = (n, ch, isCall) => {
    const root = ch[0];
    const rest = ch.slice(1).join(".");
    if (root === "escoria") return add("escoria", ch.join("."));
    if (GLOBAL_FUNCS.has(root) && ch.length === 1) return add("globals", root + (isCall ? "()" : ""));
    if (GLOBAL_CONSTS.test(root)) return add("globals", root);
    if (SINGLETONS.has(root)) return add("singletons", ch.join("."));
    if (/^[A-Z]/.test(root)) return add("classes", ch.join("."));
    if (ch.length === 1) return add("inherited", root + (isCall ? "()" : ""));
    // lower-case unknown root: an autoload of the game, or an inherited property
    add(autoloads.has(root) ? "singletons" : "inherited", ch.join("."));
  };

  const expr = (e, scope) => {
    if (!e) return;
    switch (e.k) {
      case "Name": {
        if (scope.has(e.v) || own.has(e.v)) return;
        return external(e.v, [e.v], false);
      }
      case "Attr": {
        const ch = chain(e);
        if (ch && !scope.has(ch[0]) && !own.has(ch[0])) return external(ch[0], ch, false);
        if (e.obj.k === "Self") return add("inherited", e.name);
        if (e.obj.k === "NodePath") return add("nodes", `$${e.obj.path}.${e.name}`);
        expr(e.obj, scope);
        return add("members", e.name);
      }
      case "Call": {
        const c = e.callee;
        if (c.k === "Name") {
          if (!scope.has(c.v) && !own.has(c.v)) external(c.v, [c.v], true);
        } else if (c.k === "Attr") {
          const ch = chain(c);
          if (ch && !scope.has(ch[0]) && !own.has(ch[0])) external(ch[0], [...ch.slice(0, -1), ch[ch.length - 1] + "()"], true);
          else if (c.obj.k === "Self") add("inherited", c.name + "()");
          else if (c.obj.k === "NodePath") add("nodes", `$${c.obj.path}.${c.name}()`);
          else if (c.obj.k === "Super") { /* super.method() */ }
          else {
            expr(c.obj, scope);
            add("members", c.name + "()");
          }
        } else expr(c, scope);
        e.args.forEach((a) => expr(a, scope));
        return;
      }
      case "NodePath": return add("nodes", "$" + e.path);
      case "Index": expr(e.obj, scope); return expr(e.index, scope);
      case "Unary": case "Await": case "Group": return expr(e.e, scope);
      case "Binary": expr(e.l, scope); return expr(e.r, scope);
      case "Assign": expr(e.target, scope); return expr(e.value, scope);
      case "Ternary": expr(e.cond, scope); expr(e.a, scope); return expr(e.b, scope);
      case "Array": return e.items.forEach((x) => expr(x, scope));
      case "Dict": return e.pairs.forEach(([k, v]) => (expr(k, scope), expr(v, scope)));
      case "Cast": case "Is": typeUse(e.type); return expr(e.e, scope);
      case "Lambda": return visitFunc(e.params, e.body, scope);
      case "Preload": return add("classes", "preload()");
    }
  };

  const visitMembers = (members, scope) => {
    for (const m of members) {
      if (m.k === "Func") visitFunc(m.params, m.body, scope);
      else if (m.k === "Var") {
        if (m.value) expr(m.value, scope);
        if (m.type) typeUse(m.type);
        if (m.getBody) stmts(m.getBody, new Set(scope));
        if (m.setBody) stmts(m.setBody, new Set([...scope, m.setParam]));
      } else if (m.k === "Const" && m.value) expr(m.value, scope);
      else if (m.k === "Class") visitMembers(m.members, scope);
    }
  };
  visitMembers(ast.members, new Set());
  if (ast.extends && !own.has(ast.extends)) add("classes", ast.extends + " (extends)");
  return { extends: ast.extends, classname: ast.classname, groups };
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = [];
  const walk = (d) => {
    if (fs.statSync(d).isFile()) return files.push(d);
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".gd")) files.push(p);
    }
  };
  // the game's autoloads (project.godot of the first argument's project), to tell them apart
  const autoloads = new Set();
  for (let d = path.resolve(process.argv[2] || "."); d !== "/"; d = path.dirname(d)) {
    const pg = path.join(d, "project.godot");
    if (fs.existsSync(pg)) {
      const m = /\[autoload\]([\s\S]*?)(\n\[|$)/.exec(fs.readFileSync(pg, "utf8"));
      if (m) for (const l of m[1].split("\n")) if (/^\w+=/.test(l)) autoloads.add(l.split("=")[0]);
      break;
    }
  }
  for (const d of process.argv.slice(2)) walk(d);
  for (const f of files) {
    const u = apiUsage(parse(fs.readFileSync(f, "utf8")), autoloads);
    console.log(`\n## ${f} (extends ${u.extends || "RefCounted"})`);
    for (const [g, m] of Object.entries(u.groups)) {
      if (!m.size) continue;
      console.log(`  ${g}: ${[...m.keys()].sort().join(", ")}`);
    }
  }
}
