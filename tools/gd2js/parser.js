// GDScript 4 parser: tokens -> AST (plain objects with `k` = kind).
//
// Script:   {k: "Script", tool, classname, extends, icon, members}
// Members:  Var {name, type, value, onready, export, static, getter, setter, getBody, setBody, setParam}
//           Const {name, type, value} | Signal {name, params} | Enum {name, values: [[name, expr]]}
//           Func {name, params: [{name, type, value}], ret, body, static} | Class {name, extends, members}
// Statements: Expr {e}, VarDecl {name, type, value}, ConstDecl, If {cond, body, elifs: [{cond, body}], else},
//           For {var, type, iter, body}, While {cond, body}, Match {value, branches: [{patterns, guard, body}]},
//           Return {e}, Pass, Break, Continue, Assert {args}, Breakpoint
// Expressions: Num, Str {v, kind: string|stringname|nodepath}, Bool, Null, Name {v}, Self, Super,
//           NodePath {path, unique}, Array {items}, Dict {pairs: [[k, v]]}, Unary {op, e}, Binary {op, l, r},
//           Assign {op, target, value}, Ternary {cond, a, b}, Call {callee, args}, Attr {obj, name},
//           Index {obj, index}, Await {e}, Cast {e, type}, Is {e, type, not}, Lambda {params, body, name},
//           Preload {path}, Type (for typed containers in casts)
import { tokenize, GdSyntaxError } from "./lexer.js";

const PREC = [
  ["or", "||"],
  ["and", "&&"],
  ["not"], // unary, handled specially
  ["in", "not in", "is", "is not", "as", "==", "!=", "<", ">", "<=", ">=", "&&?"],
  ["|"],
  ["^"],
  ["&"],
  ["<<", ">>"],
  ["+", "-"],
  ["*", "/", "%"],
];

export function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const next = () => toks[p++];
  const err = (msg, tk = peek()) => {
    throw new GdSyntaxError(`${msg} (found ${tk.t}${tk.v !== null && typeof tk.v !== "object" ? " " + JSON.stringify(tk.v) : ""})`, tk.line, tk.col);
  };
  const isOp = (v, o = 0) => peek(o).t === "op" && peek(o).v === v;
  const isName = (v, o = 0) => peek(o).t === "name" && peek(o).v === v;
  const accept = (v) => (isOp(v) || isName(v) ? next() : null);
  const expect = (v) => accept(v) || err(`se esperaba "${v}"`);
  const name = () => (peek().t === "name" ? next().v : err("expected a name"));
  const skipNewlines = () => {
    while (peek().t === "newline" || isOp(";")) next();
  };
  const endStatement = () => {
    if (isOp(";")) next();
    if (peek().t === "newline") return next();
    if (peek().t === "dedent" || peek().t === "eof") return;
    // a statement that ended with a block (a multi-line lambda) has no newline left
    if (p > 0 && toks[p - 1].t === "dedent") return;
    err("expected end of line");
  };

  // ---------------------------------------------------------------- types
  // int, Array[int], Dictionary[String, int], ClassA.Inner
  function type() {
    let t = name();
    while (isOp(".")) {
      next();
      t += "." + name();
    }
    if (isOp("[")) {
      next();
      const args = [type()];
      while (accept(",")) args.push(type());
      expect("]");
      t += `[${args.join(", ")}]`;
    }
    return t;
  }

  // ---------------------------------------------------------------- blocks
  function block() {
    // ":" already consumed. Either a statement on the same line or NEWLINE INDENT ... DEDENT
    if (peek().t !== "newline") return [statement()];
    next();
    skipNewlines();
    if (peek().t !== "indent") err("expected an indented block");
    next();
    const body = [];
    while (peek().t !== "dedent" && peek().t !== "eof") {
      skipNewlines();
      if (peek().t === "dedent" || peek().t === "eof") break;
      body.push(statement());
    }
    if (peek().t === "dedent") next();
    return body;
  }

  // a one-line statement after ":" (e.g. `if x: return`); several with ";"
  function simpleStatementLine() {
    const s = statementNoEnd();
    if (isOp(";")) {
      const list = [s];
      while (accept(";")) {
        if (peek().t === "newline") break;
        list.push(statementNoEnd());
      }
      endStatement();
      return { k: "Block", body: list };
    }
    endStatement();
    return s;
  }

  // ---------------------------------------------------------------- statements
  function statement() {
    const t = peek();
    if (t.t === "annotation") {
      // statement annotations (@warning_ignore...): skip them
      next();
      if (isOp("(")) argList();
      skipNewlines();
      return statement();
    }
    if (t.t === "name") {
      switch (t.v) {
        case "if": return ifStatement();
        case "for": {
          next();
          const v = name();
          let ty = null;
          if (accept(":")) ty = type();
          expect("in");
          const iter = expression();
          expect(":");
          return { k: "For", var: v, type: ty, iter, body: block() };
        }
        case "while": {
          next();
          const cond = expression();
          expect(":");
          return { k: "While", cond, body: block() };
        }
        case "match": return matchStatement();
      }
    }
    return simpleStatementLine();
  }

  function statementNoEnd() {
    const t = peek();
    if (t.t === "name") {
      switch (t.v) {
        case "pass": next(); return { k: "Pass" };
        case "break": next(); return { k: "Break" };
        case "continue": next(); return { k: "Continue" };
        case "breakpoint": next(); return { k: "Breakpoint" };
        case "return": {
          next();
          const e = peek().t === "newline" || isOp(";") || peek().t === "dedent" ? null : expression();
          return { k: "Return", e };
        }
        case "var": return varDecl();
        case "const": {
          next();
          const n = name();
          let ty = null;
          if (accept(":")) ty = isOp("=") ? null : type();
          if (!accept("=")) expect(":=");
          return { k: "ConstDecl", name: n, type: ty, value: expression() };
        }
        case "assert": {
          next();
          return { k: "Assert", args: argList() };
        }
      }
    }
    return { k: "Expr", e: expression(true) };
  }

  function varDecl() {
    expect("var");
    const n = name();
    let ty = null, value = null, infer = false;
    if (accept(":=")) {
      infer = true;
      value = expression();
    } else if (isOp(":") && peek(1).t === "newline") {
      // `var x:` followed by a get / set block (no type)
    } else if (accept(":")) {
      if (isOp("=")) infer = true;
      else ty = type();
      if (accept("=")) value = expression();
    } else if (accept("=")) value = expression();
    return { k: "VarDecl", name: n, type: ty, value, infer };
  }

  function ifStatement() {
    expect("if");
    const cond = expression();
    expect(":");
    const node = { k: "If", cond, body: block(), elifs: [], else: null };
    for (;;) {
      skipNewlinesBeforeKeyword();
      if (isName("elif")) {
        next();
        const c = expression();
        expect(":");
        node.elifs.push({ cond: c, body: block() });
      } else if (isName("else")) {
        next();
        expect(":");
        node.else = block();
        break;
      } else break;
    }
    return node;
  }

  // `elif` / `else` may follow blank lines
  function skipNewlinesBeforeKeyword() {
    let o = 0;
    while (peek(o).t === "newline") o++;
    if (peek(o).t === "name" && (peek(o).v === "elif" || peek(o).v === "else")) p += o;
  }

  function matchStatement() {
    expect("match");
    const value = expression();
    expect(":");
    expect_newline_indent();
    const branches = [];
    while (peek().t !== "dedent" && peek().t !== "eof") {
      skipNewlines();
      if (peek().t === "dedent") break;
      const patterns = [pattern()];
      while (accept(",")) patterns.push(pattern());
      let guard = null;
      if (accept("when")) guard = expression();
      expect(":");
      branches.push({ patterns, guard, body: block() });
    }
    if (peek().t === "dedent") next();
    return { k: "Match", value, branches };
  }

  function expect_newline_indent() {
    if (peek().t !== "newline") err("expected end of line");
    next();
    skipNewlines();
    if (peek().t !== "indent") err("expected indentation");
    next();
  }

  // match patterns: literal, constant expression, _, var x, [..], {..}, ..
  function pattern() {
    if (isName("_")) {
      next();
      return { k: "Wildcard" };
    }
    if (isName("var")) {
      next();
      return { k: "Bind", name: name() };
    }
    if (isOp("..")) {
      next();
      return { k: "Rest" };
    }
    if (isOp("[")) {
      next();
      const items = [];
      while (!isOp("]")) {
        items.push(pattern());
        if (!accept(",")) break;
      }
      expect("]");
      return { k: "ArrayPattern", items };
    }
    if (isOp("{")) {
      next();
      const pairs = [];
      while (!isOp("}")) {
        if (isOp("..")) {
          next();
          pairs.push([{ k: "Rest" }, null]);
        } else {
          const key = expression();
          let val = null;
          if (accept(":")) val = pattern();
          pairs.push([key, val]);
        }
        if (!accept(",")) break;
      }
      expect("}");
      return { k: "DictPattern", pairs };
    }
    return { k: "Value", e: expression() };
  }

  // ---------------------------------------------------------------- expressions

  function expression(allowAssign = false) {
    const e = ternary();
    if (allowAssign && peek().t === "op" && ["=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>="].includes(peek().v)) {
      const op = next().v;
      return { k: "Assign", op, target: e, value: expression() };
    }
    return e;
  }

  function ternary() {
    let e = binary(0);
    // a block lambda ends with a dedent: an `if` after it starts the next statement
    while (isName("if") && toks[p - 1].t !== "dedent") {
      // a if cond else b (not at the start of a statement: `if` there is a statement)
      next();
      const cond = binary(0);
      expect("else");
      const b = ternary();
      e = { k: "Ternary", cond, a: e, b };
    }
    return e;
  }

  function binary(level) {
    if (level >= PREC.length) return unary();
    if (PREC[level][0] === "not") {
      if (isName("not") || isOp("!")) {
        next();
        return { k: "Unary", op: "not", e: binary(level) };
      }
      return binary(level + 1);
    }
    let l = binary(level + 1);
    for (;;) {
      const t = peek();
      let op = null;
      if (t.t === "op" && PREC[level].includes(t.v)) op = t.v;
      else if (t.t === "name") {
        if (t.v === "not" && isName("in", 1) && PREC[level].includes("not in")) op = "not in";
        else if (t.v === "is" && PREC[level].includes("is")) op = isName("not", 1) ? "is not" : "is";
        else if (["and", "or", "in", "as"].includes(t.v) && PREC[level].includes(t.v)) op = t.v;
      }
      if (!op) return l;
      next();
      if (op === "not in" || op === "is not") next();
      if (op === "is" || op === "is not") l = { k: "Is", e: l, type: type(), not: op === "is not" };
      else if (op === "as") l = { k: "Cast", e: l, type: type() };
      else {
        const norm = { "&&": "and", "||": "or" }[op] || op;
        l = { k: "Binary", op: norm, l, r: binary(level + 1) };
      }
    }
  }

  function unary() {
    if (isOp("-") || isOp("+") || isOp("~")) {
      const op = next().v;
      return { k: "Unary", op, e: unary() };
    }
    if (isOp("!")) {
      next();
      return { k: "Unary", op: "not", e: unary() };
    }
    if (isName("await")) {
      next();
      return { k: "Await", e: unary() };
    }
    return power();
  }

  function power() {
    const base = postfix(primary());
    if (isOp("**")) {
      next();
      return { k: "Binary", op: "**", l: base, r: unary() };
    }
    return base;
  }

  function argList() {
    expect("(");
    const args = [];
    while (!isOp(")")) {
      args.push(expression());
      if (!accept(",")) break;
    }
    expect(")");
    return args;
  }

  function postfix(e) {
    for (;;) {
      if (isOp("(")) e = { k: "Call", callee: e, args: argList() };
      else if (isOp(".")) {
        next();
        e = { k: "Attr", obj: e, name: name() };
      } else if (isOp("[")) {
        next();
        const index = expression();
        expect("]");
        e = { k: "Index", obj: e, index };
      } else return e;
    }
  }

  function primary() {
    const t = next();
    switch (t.t) {
      case "number": return { k: "Num", v: t.v.value, float: t.v.float };
      case "string": return { k: "Str", v: t.v, kind: "string" };
      case "stringname": return { k: "Str", v: t.v, kind: "stringname" };
      case "nodepath": return { k: "Str", v: t.v, kind: "nodepath" };
      case "node": return { k: "NodePath", path: t.v, unique: false };
      case "unique": return { k: "NodePath", path: "%" + t.v, unique: true };
      case "name":
        switch (t.v) {
          case "true": return { k: "Bool", v: true };
          case "false": return { k: "Bool", v: false };
          case "null": return { k: "Null" };
          case "self": return { k: "Self" };
          case "super": {
            // super(...) or super.method(...)
            if (isOp(".")) {
              next();
              return { k: "Super", method: name() };
            }
            return { k: "Super", method: null };
          }
          case "func": return lambda(t);
          case "preload": {
            const args = argList();
            return { k: "Preload", path: args[0] };
          }
          case "not": return { k: "Unary", op: "not", e: unary() };
        }
        return { k: "Name", v: t.v };
      case "op":
        if (t.v === "(") {
          const e = expression();
          expect(")");
          return { k: "Group", e };
        }
        if (t.v === "[") {
          const items = [];
          while (!isOp("]")) {
            items.push(expression());
            if (!accept(",")) break;
          }
          expect("]");
          return { k: "Array", items };
        }
        if (t.v === "{") {
          const pairs = [];
          while (!isOp("}")) {
            // {key: value} or Lua style {key = value}
            if (peek().t === "name" && isOp("=", 1)) {
              const kname = next().v;
              next();
              pairs.push([{ k: "Str", v: kname, kind: "string" }, expression()]);
            } else {
              const key = expression();
              expect(":");
              pairs.push([key, expression()]);
            }
            if (!accept(",")) break;
          }
          expect("}");
          return { k: "Dict", pairs };
        }
        if (t.v === ".") return { k: "Name", v: "." + name() }; // .ENUM_VALUE shorthand (rare)
    }
    p--;
    return err("expected an expression");
  }

  // func(a, b): expr     or     func(a): <newline> block (inside brackets the
  // lexer drops newlines, so multi-line lambdas only work at statement level)
  function lambda() {
    let lname = null;
    if (peek().t === "name") lname = next().v;
    const params = paramList();
    let ret = null;
    if (accept("->")) ret = type();
    expect(":");
    let body;
    if (peek().t === "newline") body = block();
    else body = [statementNoEnd()];
    return { k: "Lambda", name: lname, params, ret, body };
  }

  function paramList() {
    expect("(");
    const params = [];
    while (!isOp(")")) {
      const n = name();
      let ty = null, value = null;
      if (accept(":")) {
        if (!isOp("=")) ty = type();
      }
      if (accept("=") || accept(":=")) value = expression();
      params.push({ name: n, type: ty, value });
      if (!accept(",")) break;
    }
    expect(")");
    return params;
  }

  // ---------------------------------------------------------------- class body

  function members(endTok) {
    const out = [];
    const annotations = [];
    for (;;) {
      skipNewlines();
      const t = peek();
      if (t.t === "eof" || (endTok && t.t === "dedent")) break;
      if (t.t === "annotation") {
        next();
        const a = { name: t.v, args: isOp("(") ? argList() : [] };
        annotations.push(a);
        continue;
      }
      if (["string", "stringname"].includes(t.t)) {
        // a string on its own (used as a comment)
        next();
        endStatement();
        continue;
      }
      const m = member(annotations.splice(0));
      if (m) out.push(m);
    }
    if (endTok && peek().t === "dedent") next();
    return out;
  }

  function member(ann) {
    const t = peek();
    const has = (n) => ann.some((a) => a.name === n || a.name.startsWith(n));
    if (t.t !== "name") err("expected a class member");
    let isStatic = false;
    if (t.v === "static") {
      next();
      isStatic = true;
    }
    switch (peek().v) {
      case "class_name": {
        next();
        const n = name();
        if (accept("extends")) script.extends = extendsTarget();
        endStatement();
        script.classname = n;
        return null;
      }
      case "extends":
        next();
        script.extends = extendsTarget();
        endStatement();
        return null;
      case "signal": {
        next();
        const n = name();
        const params = isOp("(") ? paramList() : [];
        endStatement();
        return { k: "Signal", name: n, params };
      }
      case "enum": {
        next();
        const n = peek().t === "name" ? name() : null;
        expect("{");
        const values = [];
        while (!isOp("}")) {
          const vn = name();
          values.push([vn, accept("=") ? expression() : null]);
          if (!accept(",")) break;
        }
        expect("}");
        endStatement();
        return { k: "Enum", name: n, values };
      }
      case "const": {
        const s = statementNoEnd();
        endStatement();
        return { k: "Const", name: s.name, type: s.type, value: s.value, static: true };
      }
      case "var": return varMember(ann, isStatic, has);
      case "func": return funcMember(isStatic);
      case "class": {
        next();
        const n = name();
        let ext = null;
        if (accept("extends")) ext = extendsTarget();
        expect(":");
        expect_newline_indent();
        return { k: "Class", name: n, extends: ext, members: members(true) };
      }
    }
    err("unknown class member");
  }

  function extendsTarget() {
    if (peek().t === "string") return next().v;
    return type();
  }

  function varMember(ann, isStatic, has) {
    const d = varDecl();
    const m = { k: "Var", name: d.name, type: d.type, value: d.value, static: isStatic, onready: has("onready"), export: ann.filter((a) => a.name.startsWith("export")), getter: null, setter: null };
    // property syntax:  var x: int: get = f, set = g   or a block with get: / set(v):
    if (accept(":")) {
      if (peek().t === "newline") {
        expect_newline_indent();
        while (peek().t !== "dedent" && peek().t !== "eof") {
          skipNewlines();
          if (peek().t === "dedent") break;
          const which = name();
          if (which === "get") {
            if (accept("=")) m.getter = name();
            else {
              expect(":");
              m.getBody = block();
            }
          } else if (which === "set") {
            if (accept("=")) m.setter = name();
            else {
              expect("(");
              m.setParam = name();
              if (accept(":")) type();
              expect(")");
              expect(":");
              m.setBody = block();
            }
          } else err("expected get or set");
          accept(",");
          skipNewlines();
        }
        if (peek().t === "dedent") next();
        return m;
      }
      for (;;) {
        const which = name();
        expect("=");
        if (which === "get") m.getter = name();
        else m.setter = name();
        if (!accept(",")) break;
      }
    }
    endStatement();
    return m;
  }

  function funcMember(isStatic) {
    expect("func");
    const n = name();
    const params = paramList();
    let ret = null;
    if (accept("->")) ret = type();
    expect(":");
    return { k: "Func", name: n, params, ret, body: block(), static: isStatic };
  }

  const script = { k: "Script", tool: false, classname: null, extends: null, icon: null, members: [] };
  // file-level annotations: @tool, @icon(...)
  skipNewlines();
  while (peek().t === "annotation" && ["tool", "icon", "static_unload", "abstract"].includes(peek().v)) {
    const a = next();
    if (a.v === "tool") script.tool = true;
    const args = isOp("(") ? argList() : [];
    if (a.v === "icon") script.icon = args[0];
    skipNewlines();
  }
  script.members = members(false);
  return script;
}
