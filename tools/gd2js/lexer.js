// GDScript 4 tokenizer: source -> tokens, with INDENT / DEDENT / NEWLINE.
// Inside brackets and after a "\" at the end of a line, newlines and
// indentation don't count (as in GDScript).
//
// Token: {t: type, v: value, line, col}
//   types: name, number, string, stringname (&"x"), nodepath (^"x"),
//   node ($a/b or $"a b"), unique (%name), annotation (@name), op, newline,
//   indent, dedent, eof

const OPS = [
  "**=", "<<=", ">>=", "...",
  "==", "!=", "<=", ">=", "&&", "||", "**", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", ":=", "->", "..",
  "+", "-", "*", "/", "%", "<", ">", "=", "!", "~", "&", "|", "^", "(", ")", "[", "]", "{", "}", ",", ".", ":", ";",
];

export class GdSyntaxError extends Error {
  constructor(msg, line, col) {
    super(`line ${line}: ${msg}`);
    this.line = line;
    this.col = col;
  }
}

export function tokenize(src) {
  const toks = [];
  let i = 0, line = 1, col = 1;
  let depth = 0; // open brackets
  const indents = [0];
  let lineStart = true;
  // multi-line lambdas inside brackets ("connect(func():<newline> body)"): the
  // body counts indentation again (depth 0) until it dedents back to the line
  // that opened it or a closing bracket ends it, as in GDScript
  const lambdas = []; // [{depth, indents: indents.length, base: indentation of that line}]
  let lambdaAt = -1; // depth where a "func" was seen inside brackets
  const closeLambda = () => {
    const L = lambdas.pop();
    if (toks.length && toks[toks.length - 1].t !== "newline") push("newline", null);
    while (indents.length > L.indents) {
      indents.pop();
      push("dedent", null);
    }
    depth = L.depth;
  };
  const push = (t, v, l = line, c = col) => toks.push({ t, v, line: l, col: c });
  const err = (m) => {
    throw new GdSyntaxError(m, line, col);
  };
  const adv = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === "\n") {
        line++;
        col = 1;
      } else col++;
      i++;
    }
  };

  while (i < src.length) {
    if (lineStart && depth === 0) {
      // measure indentation (tabs or spaces); blank and comment-only lines don't count
      let j = i, width = 0;
      while (src[j] === " " || src[j] === "\t") {
        width += src[j] === "\t" ? 4 : 1;
        j++;
      }
      if (src[j] === "\n" || src[j] === "\r" || src[j] === "#" || j >= src.length) {
        while (i < src.length && src[i] !== "\n") adv();
        if (i < src.length) adv();
        continue;
      }
      adv(j - i);
      lineStart = false;
      let closed = false;
      while (lambdas.length && width <= lambdas[lambdas.length - 1].base) {
        closeLambda();
        closed = true;
      }
      if (closed) continue; // back inside the brackets: this line continues them
      if (width > indents[indents.length - 1]) {
        indents.push(width);
        push("indent", null);
      } else {
        while (width < indents[indents.length - 1]) {
          indents.pop();
          push("dedent", null);
        }
        if (width !== indents[indents.length - 1]) err("inconsistent indentation");
      }
    }
    const c = src[i];
    if (c === "\n") {
      if (depth === 0) {
        if (toks.length && toks[toks.length - 1].t !== "newline") push("newline", null);
        lineStart = true;
      }
      adv();
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      adv();
      continue;
    }
    if (c === "\\" && (src[i + 1] === "\n" || (src[i + 1] === "\r" && src[i + 2] === "\n"))) {
      adv(src[i + 1] === "\r" ? 3 : 2); // line continuation
      continue;
    }
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") adv();
      continue;
    }
    const l0 = line, c0 = col;
    // strings: "x", 'x', """x""", r"x", &"x", ^"x"
    let prefix = "";
    if ((c === "&" || c === "^" || c === "r") && (src[i + 1] === '"' || src[i + 1] === "'")) {
      prefix = c;
      adv();
    }
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      const triple = src.startsWith(q.repeat(3), i);
      adv(triple ? 3 : 1);
      let s = "";
      for (;;) {
        if (i >= src.length) err("unterminated string");
        if (triple ? src.startsWith(q.repeat(3), i) : src[i] === q) {
          adv(triple ? 3 : 1);
          break;
        }
        if (src[i] === "\\" && prefix !== "r") {
          const e = src[i + 1];
          const map = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'", "0": "\0", a: "\x07", b: "\b", f: "\f", v: "\v" };
          if (e === "u" || e === "U") {
            const n = e === "u" ? 4 : 6;
            s += String.fromCodePoint(parseInt(src.substr(i + 2, n), 16));
            adv(2 + n);
          } else if (e === "\n") adv(2); // escaped newline
          else {
            s += map[e] ?? e;
            adv(2);
          }
          continue;
        }
        s += src[i];
        adv();
      }
      push(prefix === "&" ? "stringname" : prefix === "^" ? "nodepath" : "string", s, l0, c0);
      continue;
    }
    if (prefix) {
      // it was just "r" / "&" / "^" alone: rewind
      i--;
      col--;
    }
    // numbers
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1]))) {
      const m = /^(0x[0-9a-fA-F_]+|0b[01_]+|[0-9_]*\.?[0-9_]+(?:[eE][-+]?[0-9_]+)?\.?)/.exec(src.slice(i, i + 64));
      let text = m[0];
      if (text.endsWith(".") && src[i + text.length] === ".") text = text.slice(0, -1); // range-ish "1.."
      const clean = text.replace(/_/g, "");
      const v = clean.startsWith("0x") ? parseInt(clean, 16) : clean.startsWith("0b") ? parseInt(clean.slice(2), 2) : Number(clean);
      push("number", { value: v, float: /[.eE]/.test(clean) && !clean.startsWith("0x") }, l0, c0);
      adv(text.length);
      continue;
    }
    // names
    if (/[A-Za-z_À-￿]/.test(c)) {
      const m = /^[A-Za-z_0-9À-￿]+/.exec(src.slice(i, i + 256));
      push("name", m[0], l0, c0);
      if (m[0] === "func" && depth > 0) lambdaAt = depth;
      adv(m[0].length);
      continue;
    }
    // $node/path, $"quoted", %Unique
    // after a value, "%" is the modulo operator ("%s" %self)
    const prev = toks[toks.length - 1];
    const afterValue = prev && (["name", "number", "string", "stringname", "nodepath", "node", "unique"].includes(prev.t) || (prev.t === "op" && [")", "]", "}"].includes(prev.v)));
    if (c === "$" || c === "%") {
      if (c === "%" && (afterValue || !/[A-Za-z_"]/.test(src[i + 1]))) {
        // the modulo operator
      } else {
        adv();
        let path = "";
        if (src[i] === '"' || src[i] === "'") {
          const q = src[i];
          adv();
          while (src[i] !== q) {
            path += src[i];
            adv();
          }
          adv();
        } else {
          const m = /^[A-Za-z_0-9/.%]+/.exec(src.slice(i, i + 256));
          path = m ? m[0] : "";
          // a "." (not "..", the parent) starts a member: $a.b() / %a.b() -> node "a" then ".b"
          for (let k = 0; k < path.length; k++) {
            if (path[k] === "." && path[k - 1] !== "." && path[k + 1] !== ".") {
              path = path.slice(0, k);
              break;
            }
          }
          adv(path.length);
        }
        push(c === "$" ? "node" : "unique", path, l0, c0);
        continue;
      }
    }
    if (c === "@") {
      const m = /^@[A-Za-z_0-9]+/.exec(src.slice(i, i + 64));
      push("annotation", m[0].slice(1), l0, c0);
      adv(m[0].length);
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) err(`unexpected character ${JSON.stringify(c)}`);
    if (")]}".includes(op) && depth === 0 && lambdas.length) closeLambda();
    if ("([{".includes(op)) depth++;
    if (")]}".includes(op)) depth = Math.max(0, depth - 1);
    push("op", op, l0, c0);
    adv(op.length);
    if (op === ":" && depth === lambdaAt) {
      lambdaAt = -1;
      let j = i;
      while (src[j] === " " || src[j] === "\t" || src[j] === "\r") j++;
      if (src[j] === "\n" || src[j] === "#") {
        // the lambda's block starts on the next line
        lambdas.push({ depth, indents: indents.length, base: indents[indents.length - 1] });
        depth = 0;
      }
    }
  }
  while (lambdas.length) closeLambda();
  if (toks.length && toks[toks.length - 1].t !== "newline") push("newline", null);
  while (indents.length > 1) {
    indents.pop();
    push("dedent", null);
  }
  push("eof", null);
  return toks;
}
