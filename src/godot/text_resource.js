// Reader for Godot's text formats: scenes (.tscn), resources (.tres),
// project.godot and .import files. They share one syntax: `[section key=value
// ...]` headers followed by `key = value` lines, where values use Godot's
// variant text syntax (see core/variant/variant_parser.cpp).
//
// Values are returned as plain JS:
//   numbers, strings, booleans, null, arrays, objects (dictionaries);
//   constructors as {type: "Vector2", args: [1, 2]};
//   ExtResource("id") / SubResource("id") as {type: "ExtResource", args: ["id"]};
//   &"name" (StringName) as a string, ^"path" (NodePath) as {type: "NodePath", args: [path]};
//   Object(Class, "prop": value, ...) as {type: "Object", class: "Class", props: {...}};
//   typed containers Array[T]([...]) / Dictionary[K, V]({...}) as the plain container.

export class ParseError extends Error {}

class Reader {
  constructor(text) {
    this.s = text;
    this.i = 0;
  }

  error(msg) {
    const line = this.s.slice(0, this.i).split("\n").length;
    return new ParseError(`${msg} (line ${line})`);
  }

  peek() {
    return this.s[this.i];
  }

  skipSpace() {
    for (;;) {
      const c = this.s[this.i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        this.i++;
      } else if (c === ";") {
        // comments (project.godot) run to the end of the line
        while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++;
      } else {
        return;
      }
    }
  }

  expect(ch) {
    this.skipSpace();
    if (this.s[this.i] !== ch) throw this.error(`expected "${ch}", found "${this.s[this.i]}"`);
    this.i++;
  }

  identifier() {
    this.skipSpace();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i, this.i + 256));
    if (!m) throw this.error(`expected identifier, found "${this.s[this.i]}"`);
    this.i += m[0].length;
    return m[0];
  }

  string() {
    // the opening quote is at this.i
    this.i++;
    let out = "";
    for (;;) {
      if (this.i >= this.s.length) throw this.error("unterminated string");
      const c = this.s[this.i++];
      if (c === '"') return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.s[this.i++];
      switch (e) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "u": out += String.fromCharCode(parseInt(this.s.substr(this.i, 4), 16)); this.i += 4; break;
        case "U": out += String.fromCodePoint(parseInt(this.s.substr(this.i, 6), 16)); this.i += 6; break;
        default: out += e; // \" \\ \'
      }
    }
  }

  value() {
    this.skipSpace();
    const c = this.peek();
    if (c === '"') return this.string();
    if (c === "&" && this.s[this.i + 1] === '"') {
      this.i++;
      return this.string();
    }
    if (c === "^" && this.s[this.i + 1] === '"') {
      this.i++;
      return { type: "NodePath", args: [this.string()] };
    }
    if (c === "[") return this.array();
    if (c === "{") return this.dictionary();
    if (c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9")) return this.number();

    const id = this.identifier();
    switch (id) {
      case "true": return true;
      case "false": return false;
      case "null": return null;
      case "inf": return Infinity;
      case "inf_neg": return -Infinity;
      case "nan": return NaN;
    }
    this.skipSpace();
    if (id === "Array" && this.peek() === "[") {
      this.skipTypeArgs();
      this.expect("(");
      const a = this.value();
      this.expect(")");
      return a;
    }
    if (id === "Dictionary" && this.peek() === "[") {
      this.skipTypeArgs();
      this.expect("(");
      const d = this.value();
      this.expect(")");
      return d;
    }
    if (this.peek() !== "(") return { type: "Identifier", args: [id] };
    this.i++;
    if (id === "Object") return this.object();
    const args = [];
    this.skipSpace();
    while (this.peek() !== ")") {
      args.push(this.value());
      this.skipSpace();
      if (this.peek() === ",") this.i++;
      this.skipSpace();
    }
    this.i++;
    return { type: id, args };
  }

  skipTypeArgs() {
    // Array[PackedInt32Array] / Dictionary[String, int] / Array[ExtResource("x")]
    let depth = 0;
    do {
      const c = this.s[this.i++];
      if (c === "[") depth++;
      else if (c === "]") depth--;
      else if (c === '"') { this.i--; this.string(); }
    } while (depth > 0 && this.i < this.s.length);
  }

  object() {
    const cls = this.identifier();
    const props = {};
    this.skipSpace();
    while (this.peek() === ",") {
      this.i++;
      this.skipSpace();
      if (this.peek() !== '"') throw this.error("expected property name in Object()");
      const key = this.string();
      this.expect(":");
      props[key] = this.value();
      this.skipSpace();
    }
    this.expect(")");
    return { type: "Object", class: cls, props };
  }

  number() {
    const m = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(this.s.slice(this.i, this.i + 64));
    if (!m) {
      // -inf written as "-inf"
      if (this.s.startsWith("-inf", this.i)) {
        this.i += 4;
        return -Infinity;
      }
      throw this.error("bad number");
    }
    this.i += m[0].length;
    return Number(m[0]);
  }

  array() {
    this.i++;
    const out = [];
    this.skipSpace();
    while (this.peek() !== "]") {
      out.push(this.value());
      this.skipSpace();
      if (this.peek() === ",") this.i++;
      this.skipSpace();
    }
    this.i++;
    return out;
  }

  dictionary() {
    this.i++;
    const out = {};
    this.skipSpace();
    while (this.peek() !== "}") {
      let key = this.value();
      if (typeof key !== "string") key = JSON.stringify(key);
      this.expect(":");
      out[key] = this.value();
      this.skipSpace();
      if (this.peek() === ",") this.i++;
      this.skipSpace();
    }
    this.i++;
    return out;
  }

  // section tag: identifier, or a plain name like [input] / [editor_plugins]
  key0() {
    this.skipSpace();
    const m = /^[^\s\]]+/.exec(this.s.slice(this.i, this.i + 256));
    this.i += m[0].length;
    return m[0];
  }

  // `key = value` or `key=value`; keys may hold "/", ":", "." or be quoted
  key() {
    this.skipSpace();
    if (this.peek() === '"') return this.string();
    const start = this.i;
    while (this.i < this.s.length && this.s[this.i] !== "=" && this.s[this.i] !== "\n") this.i++;
    return this.s.slice(start, this.i).trim();
  }
}

/** Parses one variant value from text, e.g. `Vector2(1, 2)`. */
export function parseValue(text) {
  return new Reader(text).value();
}

/**
 * Parses a .tscn / .tres / project.godot / .import file.
 * Returns {header, sections}: `header` is the first section if it is
 * gd_scene / gd_resource, otherwise null; every section is
 * {tag, attrs: {...header values}, props: {...key = value lines}}.
 * Lines before the first section go into a section with tag "".
 */
export function parseTextResource(text) {
  const r = new Reader(text);
  const sections = [];
  let cur = { tag: "", attrs: {}, props: {} };
  for (;;) {
    r.skipSpace();
    if (r.i >= r.s.length) break;
    if (r.peek() === "[") {
      r.i++;
      if (cur.tag !== "" || Object.keys(cur.props).length) sections.push(cur);
      // [section] / [node name="x" type="Y"] / [ext_resource ...]
      const tag = r.key0();
      cur = { tag, attrs: {}, props: {} };
      r.skipSpace();
      while (r.peek() !== "]") {
        const k = r.identifier();
        r.expect("=");
        cur.attrs[k] = r.value();
        r.skipSpace();
      }
      r.i++;
      continue;
    }
    const k = r.key();
    r.expect("=");
    cur.props[k] = r.value();
  }
  if (cur.tag !== "" || Object.keys(cur.props).length) sections.push(cur);
  const first = sections[0];
  const header = first && (first.tag === "gd_scene" || first.tag === "gd_resource") ? first : null;
  return { header, sections };
}
