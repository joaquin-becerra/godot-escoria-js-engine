// ASHES compiler: source -> ESC script ({file, events: [...], errors}).
// Port of esc_compiler.gd and compiler/esc_resolver.gd
// (Escoria, MIT license, (c) Godot Escoria contributors).
import { scan } from "./scanner.js";
import { parse } from "./parser.js";

/**
 * Compiles an ESC script. Top-level statements that are not events are
 * dropped (Escoria only keeps events in an ESCScript).
 * Returns {file, events: Map("name" or "name target" -> Event), errors: [...]}.
 */
export function compile(source, file = "", objectGlobalId = "") {
  const errors = [];
  const tokens = scan(source, file, errors);
  const statements = parse(tokens, objectGlobalId, errors);
  const events = new Map();
  if (!errors.length) {
    for (const s of statements) {
      if (s.kind !== "Event") continue;
      const key = eventKey(s.name, s.target);
      if (events.has(key)) {
        errors.push(`${file}: Duplicate event '${s.name}' with target '${s.target || ""}'.`);
        continue;
      }
      events.set(key, s);
    }
  }
  return { file, events, errors };
}

export const eventKey = (name, target) => (target ? `${name} ${target}` : name);

/**
 * Resolver: for every variable read or assignment, how many scopes up its
 * `var` is (Map expr -> depth). Variables not found are globals.
 */
export function resolve(stmt, locals = new Map()) {
  const scopes = []; // innermost first: Map name -> defined?
  const resolveLocal = (expr, name) => {
    for (let i = 0; i < scopes.length; i++) {
      if (scopes[i].has(name.lexeme)) {
        locals.set(expr, i);
        return;
      }
    }
  };
  const st = (s) => {
    if (!s) return;
    switch (s.kind) {
      case "Event": return st(s.body);
      case "Block":
        scopes.unshift(new Map());
        s.statements.forEach(st);
        scopes.shift();
        return;
      case "Expression": return ex(s.expr);
      case "If":
        ex(s.cond);
        st(s.then);
        for (const b of s.elifs) {
          ex(b.cond);
          st(b.then);
        }
        return st(s.else);
      case "While":
        ex(s.cond);
        return st(s.body);
      case "Var":
        if (scopes.length) scopes[0].set(s.name.lexeme, false);
        if (s.init) ex(s.init);
        if (scopes.length) scopes[0].set(s.name.lexeme, true);
        return;
      case "DialogOption":
        ex(s.option);
        if (s.cond) ex(s.cond);
        return st(s.body);
      case "Dialog":
        s.args.forEach(ex);
        s.options.forEach(st);
        return;
      case "Break":
        if (s.levels) ex(s.levels);
        return;
    }
  };
  const ex = (e) => {
    switch (e.kind) {
      case "Call":
        ex(e.callee);
        e.args.forEach(ex);
        return;
      case "Assign":
        ex(e.value);
        return resolveLocal(e, e.name);
      case "InInventory": return ex(e.id);
      case "Is":
        ex(e.id);
        if (e.state) ex(e.state);
        return;
      case "Binary":
      case "Logical":
        ex(e.left);
        return ex(e.right);
      case "Grouping": return ex(e.expr);
      case "Unary": return ex(e.right);
      case "Variable":
        if (e.name.lexeme.startsWith("$")) return;
        return resolveLocal(e, e.name);
    }
  };
  st(stmt);
  return locals;
}
