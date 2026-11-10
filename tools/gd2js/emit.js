// GDScript AST (parser.js) -> a JS module over the bridge (src/godot/bridge).
//
// The module:   export default function (gd) { ...; return <ScriptClass>; }
// The class extends gd.base("<Godot class>") and stands for the node the
// script is attached to (or the command, for ESCBaseCommand scripts).
//
// Names resolve as in GDScript: locals; the script's constants and enums
// (module constants); its vars, funcs and signals (this.x); globals
// (gd.G.x); classes (gd.cls("X")); `escoria`; singletons; anything else is
// inherited from the base class (this.x). Operators and methods on values of
// unknown type go through gd.op / gd.call.
import { GLOBALS } from "../../src/godot/bridge/values.js";

const SINGLETONS = new Set(["Engine", "Input", "OS", "Time", "ProjectSettings", "TranslationServer", "AudioServer", "RenderingServer", "DisplayServer", "ResourceLoader", "JSON"]);
const ARITH = { "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod", "**": "pow" };
// GDScript names that can't be JS variables get a trailing "_"
const JS_RESERVED = new Set(["arguments", "eval", "new", "delete", "default", "switch", "case", "function", "let", "typeof", "instanceof", "void", "with", "yield", "this", "catch", "try", "finally", "throw", "do", "import", "export", "debugger", "interface", "package", "private", "protected", "public", "implements", "static", "enum", "class", "const", "var", "super", "in", "of", "await", "async", "undefined", "NaN", "Infinity"]);
// ...and so do the names the module uses for the bridge's helpers
const HELPERS = new Set(["op", "call", "iter", "truthy", "G", "gd"]);
const js = (n) => (JS_RESERVED.has(n) || HELPERS.has(n) ? n + "_" : n);

const BUILTIN_TYPES = new Set(["Vector2", "Vector2i", "Vector3", "Vector3i", "Color", "Rect2", "Rect2i"]);

const TYPE_DEFAULTS = { int: "0", float: "0", bool: "false", String: '""', StringName: '""', Array: "[]", Dictionary: "{}", Vector2: "new gd.Vector2()" };

export function emitModule(ast, { source = "", className = "Script", autoloads = new Set() } = {}) {
  const out = [];
  const notes = new Set(); // things the translation can't do (reported)
  const w = (s) => out.push(s);

  w(`// Translated from ${source} by tools/gd2js. Don't edit: translate the .gd again.`);
  w(`export default function (gd) {`);
  w(`  const { op, call, iter, truthy, G } = gd;`);
  const top = classInfo(ast.members);
  top.autoloads = autoloads;
  emitConsts(ast.members, top, "  ", w);
  for (const m of ast.members.filter((m) => m.k === "Class")) emitClass(m.name, m.extends, m.members, classInfo(m.members, top), "  ", w, notes);
  const base = ast.extends || "RefCounted";
  emitClass(className, base, ast.members, top, "  ", w, notes);
  w(`  return ${className};`);
  w(`}`);
  return { code: out.join("\n") + "\n", notes: [...notes] };
}

// ---------------------------------------------------------------- class info

function classInfo(members, parent = null) {
  const info = { autoloads: parent ? parent.autoloads : new Set(), consts: new Set(parent ? parent.consts : []), vars: new Set(), funcs: new Set(), signals: new Set(), classes: new Set(parent ? parent.classes : []), staticFuncs: new Set(), backing: new Map() };
  for (const m of members) {
    if (m.k === "Const") info.consts.add(m.name);
    else if (m.k === "Enum") {
      if (m.name) info.consts.add(m.name);
      else for (const [v] of m.values) info.consts.add(v);
    } else if (m.k === "Var") info.vars.add(m.name);
    else if (m.k === "Func") (m.static ? info.staticFuncs : info.funcs).add(m.name);
    else if (m.k === "Signal") info.signals.add(m.name);
    else if (m.k === "Class") info.classes.add(m.name);
  }
  // properties with get / set functions: inside those, the name is the backing field
  for (const m of members) {
    if (m.k !== "Var" || !(m.getter || m.setter || m.getBody || m.setBody)) continue;
    info.backing.set(m.name, `__p_${m.name}`);
  }
  return info;
}

function emitConsts(members, info, ind, w) {
  // constants and enums in order (they can use each other); class-level, so module consts
  const ctx = makeCtx(info, null);
  for (const m of members) {
    if (m.k === "Const") w(`${ind}const ${m.name} = ${ex(m.value, ctx)};`);
    else if (m.k === "Enum") {
      let n = 0;
      const pairs = m.values.map(([name, v]) => {
        const val = v ? ex(v, ctx) : String(n);
        n = v && v.k === "Num" ? v.v + 1 : n + 1;
        return [name, val];
      });
      if (m.name) w(`${ind}const ${m.name} = Object.freeze({ ${pairs.map(([a, b]) => `${a}: ${b}`).join(", ")} });`);
      else for (const [a, b] of pairs) w(`${ind}const ${a} = ${b};`);
    }
  }
}

// ---------------------------------------------------------------- classes

function emitClass(name, ext, members, info, ind, w, notes) {
  let base;
  if (!ext) base = `gd.base("RefCounted")`;
  else if (/^res:\/\//.test(ext) || /\.gd$/.test(ext)) base = `gd.baseScript(${JSON.stringify(ext)})`; // another script (translated, or one of Escoria's)
  else if (info.classes.has(ext)) base = ext;
  else base = `gd.base(${JSON.stringify(ext)})`; // a Godot / Escoria class, or a class_name of the game
  const isCommand = ext === "ESCBaseCommand";
  w(`${ind}class ${name} extends ${base} {`);
  const i2 = ind + "  ", i3 = ind + "    ";
  // constructor: var initializers (not @onready), with @export values from the scene
  const vars = members.filter((m) => m.k === "Var" && !m.static);
  w(`${i2}constructor(...args) {`);
  w(`${i3}super(...args);`);
  // the script's vars are declared on the instance (__field); other names a
  // script assigns are the node's properties (the bridge's nodes keep them in props)
  for (const v of vars) {
    const field = info.backing.get(v.name) || v.name;
    let init = v.onready ? "null" : v.value ? ex(v.value, makeCtx(info, null, true)) : TYPE_DEFAULTS[v.type?.replace(/\[.*$/, "")] || "null";
    if (!v.onready && v.export && v.export.length && !isCommand) init = `this.__export(${JSON.stringify(v.name)}, ${init})`;
    w(`${i3}this.__field(${JSON.stringify(field)}, ${init});`);
  }
  // GDScript's constructor, with the arguments of X.new(...) (once, in the most derived class)
  if (members.some((m) => m.k === "Func" && m.name === "_init")) w(`${i3}if (new.target === ${name}) this._init(...gd.initArgs(args));`);
  w(`${i2}}`);
  const onready = vars.filter((v) => v.onready);
  if (onready.length) {
    w(`${i2}__onready() {`);
    for (const v of onready) w(`${i3}this.${info.backing.get(v.name) || v.name} = ${v.value ? ex(v.value, makeCtx(info, null, true)) : "null"};`);
    w(`${i2}}`);
  }
  // the script's signals, as properties (obj.clicked.connect(...), await obj.clicked)
  for (const s of members.filter((m) => m.k === "Signal")) w(`${i2}get ${s.name}() { return this.signal(${JSON.stringify(s.name)}); }`);
  // property accessors
  for (const v of vars) {
    const field = info.backing.get(v.name);
    if (!field) continue;
    if (v.getter) w(`${i2}get ${v.name}() { return this.${v.getter}(); }`);
    else if (v.getBody) w(`${i2}get ${v.name}() {\n${stmts(v.getBody, makeCtx(info, { backingFor: v.name }), i3)}${i2}}`);
    else w(`${i2}get ${v.name}() { return this.${field}; }`);
    if (v.setter) w(`${i2}set ${v.name}(value) { this.${v.setter}(value); }`);
    else if (v.setBody) {
      const ctx = makeCtx(info, { backingFor: v.name });
      ctx.locals.add(v.setParam);
      w(`${i2}set ${v.name}(${js(v.setParam)}) {\n${stmts(v.setBody, ctx, i3)}${i2}}`);
    } else w(`${i2}set ${v.name}(value) { this.${field} = value; }`);
  }
  // functions
  const accessorFns = new Map();
  for (const v of vars) {
    if (v.getter) accessorFns.set(v.getter, v.name);
    if (v.setter) accessorFns.set(v.setter, v.name);
  }
  for (const f of members.filter((m) => m.k === "Func")) {
    const ctx = makeCtx(info, { method: f.name, backingFor: accessorFns.get(f.name) || null, isStatic: f.static });
    for (const p of f.params) ctx.locals.add(p.name);
    const params = f.params.map((p) => (p.value ? `${js(p.name)} = ${ex(p.value, ctx)}` : js(p.name))).join(", ");
    const isAsync = hasAwait(f.body);
    w(`${i2}${f.static ? "static " : ""}${isAsync ? "async " : ""}${f.name}(${params}) {`);
    out_stmts(f.body, ctx, i3, w);
    w(`${i2}}`);
    if (ctx.notes) for (const n of ctx.notes) notes.add(n);
  }
  w(`${ind}}`);
  // the class's constants and enums are also read from outside (ScummScreen.GLOBAL)
  const named = [];
  for (const m of members) {
    if (m.k === "Const") named.push(m.name);
    else if (m.k === "Enum") {
      if (m.name) named.push(m.name);
      else for (const [v] of m.values) named.push(v);
    }
  }
  if (named.length) w(`${ind}Object.assign(${name}, { ${named.join(", ")} });`);
}

// does a body use await (not counting lambdas inside it)?
function hasAwait(body) {
  let found = false;
  const visit = (n) => {
    if (!n || found || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (n.k === "Lambda") return;
    if (n.k === "Await") return void (found = true);
    for (const v of Object.values(n)) if (v && typeof v === "object") visit(v);
  };
  visit(body);
  return found;
}

// ---------------------------------------------------------------- statements

function makeCtx(info, fn, inConstructor = false) {
  return { info, locals: new Set(), fn: fn || {}, notes: [], inConstructor };
}

function out_stmts(list, ctx, ind, w) {
  w(stmts(list, ctx, ind).replace(/\n$/, ""));
}

function stmts(list, ctx, ind) {
  let s = "";
  for (const st of list) s += stmt(st, ctx, ind);
  return s;
}

function block(list, ctx, ind) {
  const c = { ...ctx, locals: new Set(ctx.locals) };
  return stmts(list, c, ind + "  ");
}

function stmt(s, ctx, ind) {
  switch (s.k) {
    case "Expr": return `${ind}${ex(s.e, ctx, true)};\n`;
    case "VarDecl": {
      const init = s.value ? ex(s.value, ctx) : TYPE_DEFAULTS[s.type?.replace(/\[.*$/, "")] || "null";
      ctx.locals.add(s.name);
      return `${ind}let ${js(s.name)} = ${init};\n`;
    }
    case "ConstDecl":
      ctx.locals.add(s.name);
      return `${ind}const ${js(s.name)} = ${ex(s.value, ctx)};\n`;
    case "If": {
      let r = `${ind}if (truthy(${ex(s.cond, ctx)})) {\n${block(s.body, ctx, ind)}${ind}}`;
      for (const b of s.elifs) r += ` else if (truthy(${ex(b.cond, ctx)})) {\n${block(b.body, ctx, ind)}${ind}}`;
      if (s.else) r += ` else {\n${block(s.else, ctx, ind)}${ind}}`;
      return r + "\n";
    }
    case "For": {
      const c = { ...ctx, locals: new Set([...ctx.locals, s.var]) };
      return `${ind}for (let ${js(s.var)} of iter(${ex(s.iter, ctx)})) {\n${stmts(s.body, c, ind + "  ")}${ind}}\n`;
    }
    case "While": return `${ind}while (truthy(${ex(s.cond, ctx)})) {\n${block(s.body, ctx, ind)}${ind}}\n`;
    case "Match": {
      const v = `__m${(ctx.matchN = (ctx.matchN || 0) + 1)}`;
      let r = `${ind}{\n${ind}  const ${v} = ${ex(s.value, ctx)};\n`;
      s.branches.forEach((b, i) => {
        const c = { ...ctx, locals: new Set(ctx.locals) };
        const binds = [];
        const conds = b.patterns.map((p) => pattern(p, v, c, binds));
        let cond = conds.includes("true") ? "true" : conds.join(" || ");
        if (b.guard) cond = `(${cond}) && truthy(${ex(b.guard, c)})`;
        r += `${ind}  ${i ? "else " : ""}if (${cond}) {\n${binds.map((x) => `${ind}    let ${js(x)} = ${v};\n`).join("")}${stmts(b.body, c, ind + "    ")}${ind}  }\n`;
      });
      return r + `${ind}}\n`;
    }
    case "Return": return `${ind}return${s.e ? " " + ex(s.e, ctx) : ""};\n`;
    case "Pass": return "";
    case "Break": return `${ind}break;\n`;
    case "Continue": return `${ind}continue;\n`;
    case "Breakpoint": return "";
    case "Assert": return `${ind}console.assert(truthy(${ex(s.args[0], ctx)})${s.args[1] ? ", " + ex(s.args[1], ctx) : ""});\n`;
    case "Block": return stmts(s.body, ctx, ind);
  }
  ctx.notes.push(`statement ${s.k} not translated`);
  return `${ind}/* ${s.k} */\n`;
}

function pattern(p, v, ctx, binds) {
  switch (p.k) {
    case "Wildcard": return "true";
    case "Bind":
      binds.push(p.name);
      ctx.locals.add(p.name);
      return "true";
    case "Value": return `op.eq(${v}, ${ex(p.e, ctx)})`;
  }
  ctx.notes.push(`match pattern ${p.k} not translated`);
  return "false";
}

// ---------------------------------------------------------------- expressions

function isNum(e) {
  return e.k === "Num" || (e.k === "Unary" && e.op === "-" && e.e.k === "Num");
}

// how a bare name reads in JS
function nameRef(n, ctx) {
  const { info } = ctx;
  if (ctx.locals.has(n)) return js(n);
  if (ctx.fn.backingFor === n) return `this.${info.backing.get(n)}`;
  if (info.consts.has(n) || info.classes.has(n)) return n;
  if (info.signals.has(n)) return `this.signal(${JSON.stringify(n)})`;
  if (info.funcs.has(n)) return `gd.Callable(this, ${JSON.stringify(n)})`;
  if (info.staticFuncs.has(n)) return `this.constructor.${n}`;
  if (info.vars.has(n)) return `this.${n}`;
  if (n === "escoria") return "gd.escoria";
  if (info.autoloads.has(n)) return `gd.autoload(${JSON.stringify(n)})`;
  // a built-in type as a value (Vector2i.ZERO, Color.BLACK): the class, not
  // its constructor function (Vector2(1, 2) is a call: callExpr)
  if (BUILTIN_TYPES.has(n)) return `gd.cls(${JSON.stringify(n)})`;
  if (n in GLOBALS) return `G.${n}`;
  if (SINGLETONS.has(n)) return `gd.singleton(${JSON.stringify(n)})`;
  if (/^[A-Z]/.test(n)) return `gd.cls(${JSON.stringify(n)})`;
  // inherited from the base class: a property, or a method used as a value (a Callable)
  return ctx.asTarget ? `this.${n}` : `gd.member(this, ${JSON.stringify(n)})`;
}

function args(list, ctx) {
  return list.map((a) => ex(a, ctx)).join(", ");
}

export function ex(e, ctx, statement = false) {
  switch (e.k) {
    case "Num": return e.float && Number.isInteger(e.v) ? `${e.v}.0` : String(e.v);
    case "Str": return JSON.stringify(e.v);
    case "Bool": return String(e.v);
    case "Null": return "null";
    case "Self": return "this";
    case "Name": return nameRef(e.v, ctx);
    case "NodePath": return `this.get_node(${JSON.stringify(e.path)})`;
    case "Group": return `(${ex(e.e, ctx)})`;
    case "Array": return `[${args(e.items, ctx)}]`;
    case "Dict": return `{ ${e.pairs.map(([k, v]) => `${k.k === "Str" ? JSON.stringify(k.v) : `[${ex(k, ctx)}]`}: ${ex(v, ctx)}`).join(", ")} }`;
    case "Preload": return `gd.preload(${ex(e.path, ctx)})`;
    case "Await": return `(await ${ex(e.e, ctx)})`;
    case "Cast": return ex(e.e, ctx);
    case "Is": return `${e.not ? "!" : ""}gd.is(${ex(e.e, ctx)}, ${JSON.stringify(e.type.replace(/\[.*$/, ""))})`;
    case "Ternary": return `(truthy(${ex(e.cond, ctx)}) ? ${ex(e.a, ctx)} : ${ex(e.b, ctx)})`;
    case "Unary":
      if (e.op === "not") return `!truthy(${ex(e.e, ctx)})`;
      if (e.op === "-") return isNum(e.e) ? `-${ex(e.e, ctx)}` : `op.neg(${ex(e.e, ctx)})`;
      if (e.op === "+") return ex(e.e, ctx);
      return `${e.op}${ex(e.e, ctx)}`;
    case "Binary": {
      const l = ex(e.l, ctx), r = ex(e.r, ctx);
      switch (e.op) {
        case "and": return `(truthy(${l}) && truthy(${r}))`;
        case "or": return `(truthy(${l}) || truthy(${r}))`;
        case "==": return `op.eq(${l}, ${r})`;
        case "!=": return `op.ne(${l}, ${r})`;
        case "in": return `op.in(${l}, ${r})`;
        case "not in": return `!op.in(${l}, ${r})`;
        case "<": case ">": case "<=": case ">=": case "&": case "|": case "^": case "<<": case ">>":
          return `(${l} ${e.op} ${r})`;
      }
      if (ARITH[e.op]) {
        if (isNum(e.l) && isNum(e.r)) {
          if (e.op === "/" && !e.l.float && !e.r.float) return `Math.trunc(${l} / ${r})`;
          return `(${l} ${e.op} ${r})`;
        }
        return `op.${ARITH[e.op]}(${l}, ${r})`;
      }
      ctx.notes.push(`operator ${e.op} not translated`);
      return `undefined /* ${e.op} */`;
    }
    case "Assign": return assign(e, ctx);
    case "Index": return `op.get(${ex(e.obj, ctx)}, ${ex(e.index, ctx)})`;
    case "Attr": {
      // obj.method as a value is a Callable bound to obj (obj.prop: its value)
      if (ctx.asTarget) return `${e.obj.k === "Self" ? "this" : ex(e.obj, { ...ctx, asTarget: false })}.${e.name}`;
      if (e.obj.k === "Self") return ctx.info.vars.has(e.name) ? `this.${e.name}` : `gd.member(this, ${JSON.stringify(e.name)})`;
      return `gd.member(${ex(e.obj, ctx)}, ${JSON.stringify(e.name)})`;
    }
    case "Super": return `super.${e.method || ctx.fn.method}`;
    case "Call": return callExpr(e, ctx);
    case "Lambda": {
      const c = { ...ctx, locals: new Set(ctx.locals), fn: { ...ctx.fn, method: null } };
      for (const p of e.params) c.locals.add(p.name);
      const ps = e.params.map((p) => (p.value ? `${js(p.name)} = ${ex(p.value, c)}` : js(p.name))).join(", ");
      const body = e.body.length === 1 && e.body[0].k === "Expr" ? `{ return ${ex(e.body[0].e, c)}; }` : `{\n${stmts(e.body, c, "      ")}    }`;
      return `(${hasAwait(e.body) ? "async " : ""}(${ps}) => ${body})`;
    }
  }
  ctx.notes.push(`expression ${e.k} not translated`);
  return `undefined /* ${e.k} */`;
}

function assign(e, ctx) {
  const t = e.target;
  const value = (cur) => (e.op === "=" ? ex(e.value, ctx) : arith(e.op.slice(0, -1), cur, ex(e.value, ctx), e.value));
  const arith = (op, cur, v, ve) => {
    if (ARITH[op]) return isNum(ve) && /^-?[\d.]+$/.test(cur) ? `${cur} ${op} ${v}` : `op.${ARITH[op]}(${cur}, ${v})`;
    return `(${cur} ${op} ${v})`;
  };
  // a field of a property that is a value (node.position.y = 1, modulate.a -= x):
  // GDScript reads the property, changes the copy and writes it back
  let holder = t.obj;
  // position.x = ... (a property of the node itself, inherited): as self.position.x
  if ((t.k === "Attr" || t.k === "Index") && holder && holder.k === "Name" && !ctx.locals.has(holder.v) && !ctx.info.vars.has(holder.v) && !ctx.info.consts.has(holder.v) && nameRef(holder.v, ctx).startsWith("this.")) {
    holder = { k: "Attr", name: holder.v, obj: { k: "Self" } };
  }
  if ((t.k === "Attr" || t.k === "Index") && holder && (holder.k === "Attr" || holder.k === "Index") && (holder.obj.k !== "Self" || holder.k === "Attr")) {
    const inner = t.k === "Attr" ? `__t.${t.name}` : `op.get(__t, ${ex(t.index, ctx)})`;
    const setInner = (v) => (t.k === "Attr" ? `__t.${t.name} = ${v}` : `op.set(__t, ${ex(t.index, ctx)}, ${v})`);
    const read = holder.k === "Attr" ? `__o.${holder.name}` : `op.get(__o, ${ex(holder.index, ctx)})`;
    const write = holder.k === "Attr" ? `__o.${holder.name} = __t` : `op.set(__o, ${ex(holder.index, ctx)}, __t)`;
    // (written back only if it is a value: an object is changed in place)
    return `((__o) => { const __t = ${read}; ${setInner(value(inner))}; if (gd.isValue(__t)) ${write}; return ${inner}; })(${ex(holder.obj, ctx)})`;
  }
  if (t.k === "Index") {
    const o = ex(t.obj, ctx), i = ex(t.index, ctx);
    return `op.set(${o}, ${i}, ${value(`op.get(${o}, ${i})`)})`;
  }
  const target = ex(t, { ...ctx, asTarget: true });
  return `${target} = ${value(target)}`;
}

function callExpr(e, ctx) {
  const c = e.callee, a = args(e.args, ctx);
  const { info } = ctx;
  if (c.k === "Name") {
    const n = c.v;
    if (ctx.locals.has(n)) return `${js(n)}.call(${a})`; // a Callable in a variable
    if (info.funcs.has(n)) return `this.${n}(${a})`;
    if (info.staticFuncs.has(n)) return `${ctx.fn.isStatic ? "this" : "this.constructor"}.${n}(${a})`;
    if (n === "Callable") return `gd.Callable(${a})`;
    if (n in GLOBALS) return `G.${n}(${a})`;
    if (info.classes.has(n)) return `new ${n}(${a})`;
    return `this.${n}(${a})`; // inherited method
  }
  if (c.k === "Super") return `super.${c.method || ctx.fn.method}?.(${a})`;
  if (c.k === "Attr") {
    const obj = c.obj, m = c.name;
    if (m === "new") {
      if (obj.k === "Name" && info.classes.has(obj.v)) return `new ${obj.v}(${a})`;
      if (obj.k === "Name" && /^[A-Z]/.test(obj.v)) return `gd.new_(${JSON.stringify(obj.v)}, [${a}])`;
      return `new (${ex(obj, ctx)})(${a})`;
    }
    if (obj.k === "Self") return `this.${m}(${a})`;
    if (obj.k === "Super") return `super.${m}?.(${a})`;
    // bridge objects (classes, escoria, nodes): their methods directly
    // (not the script's own constants: arrays, dictionaries, enums)
    if (obj.k === "Name" && !ctx.locals.has(obj.v) && !info.consts.has(obj.v) && (/^[A-Z]/.test(obj.v) || obj.v === "escoria")) return `${ex(obj, ctx)}.${m}(${a})`;
    if (obj.k === "NodePath") return `${ex(obj, ctx)}.${m}(${a})`;
    if (chainRoot(obj) === "escoria") return `${ex(obj, ctx)}.${m}(${a})`;
    return `call(${ex(obj, ctx)}, ${JSON.stringify(m)}${a ? ", " + a : ""})`;
  }
  return `${ex(c, ctx)}.call(${a})`;
}

function chainRoot(e) {
  while (e.k === "Attr" || e.k === "Call") e = e.k === "Attr" ? e.obj : e.callee;
  return e.k === "Name" ? e.v : null;
}
