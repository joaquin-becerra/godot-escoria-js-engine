// Godot's built-in value types and GDScript's operators and global functions,
// for code translated from GDScript (tools/gd2js). The translator doesn't
// know types, so operators and methods on unknown values go through these
// helpers, which look at the values at run time.

export class Vector2 {
  constructor(x = 0, y = 0) {
    if (x instanceof Vector2) [x, y] = [x.x, x.y];
    this.x = x;
    this.y = y;
  }
  static get ZERO() { return new Vector2(0, 0); }
  static get ONE() { return new Vector2(1, 1); }
  static get UP() { return new Vector2(0, -1); }
  static get DOWN() { return new Vector2(0, 1); }
  static get LEFT() { return new Vector2(-1, 0); }
  static get RIGHT() { return new Vector2(1, 0); }
  length() { return Math.hypot(this.x, this.y); }
  length_squared() { return this.x * this.x + this.y * this.y; }
  normalized() {
    const l = this.length();
    return l ? new Vector2(this.x / l, this.y / l) : new Vector2();
  }
  distance_to(v) { return Math.hypot(v.x - this.x, v.y - this.y); }
  distance_squared_to(v) { return (v.x - this.x) ** 2 + (v.y - this.y) ** 2; }
  direction_to(v) { return new Vector2(v.x - this.x, v.y - this.y).normalized(); }
  angle() { return Math.atan2(this.y, this.x); }
  angle_to_point(v) { return Math.atan2(v.y - this.y, v.x - this.x); }
  dot(v) { return this.x * v.x + this.y * v.y; }
  abs() { return new Vector2(Math.abs(this.x), Math.abs(this.y)); }
  floor() { return new Vector2(Math.floor(this.x), Math.floor(this.y)); }
  round() { return new Vector2(Math.round(this.x), Math.round(this.y)); }
  clamp(a, b) { return new Vector2(Math.min(Math.max(this.x, a.x), b.x), Math.min(Math.max(this.y, a.y), b.y)); }
  lerp(v, t) { return new Vector2(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t); }
  move_toward(v, d) {
    const dx = v.x - this.x, dy = v.y - this.y, l = Math.hypot(dx, dy);
    return l <= d || l === 0 ? new Vector2(v.x, v.y) : new Vector2(this.x + (dx / l) * d, this.y + (dy / l) * d);
  }
  rotated(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Vector2(this.x * c - this.y * s, this.x * s + this.y * c);
  }
  is_equal_approx(v) { return Math.abs(this.x - v.x) < 1e-5 && Math.abs(this.y - v.y) < 1e-5; }
  duplicate() { return new Vector2(this.x, this.y); }
  toString() { return `(${fmtNum(this.x)}, ${fmtNum(this.y)})`; }
}

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    if (x instanceof Vector3) [x, y, z] = [x.x, x.y, x.z];
    this.x = x;
    this.y = y;
    this.z = z;
  }
  static get ZERO() { return new Vector3(); }
  static get ONE() { return new Vector3(1, 1, 1); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  duplicate() { return new Vector3(this.x, this.y, this.z); }
  toString() { return `(${fmtNum(this.x)}, ${fmtNum(this.y)}, ${fmtNum(this.z)})`; }
}

export class Color {
  constructor(r = 0, g = 0, b = 0, a = 1) {
    if (typeof r === "string") return Color.html(r);
    Object.assign(this, { r, g, b, a });
  }
  static get BLACK() { return new Color(0, 0, 0, 1); }
  static get WHITE() { return new Color(1, 1, 1, 1); }
  static get TRANSPARENT() { return new Color(1, 1, 1, 0); }
  static get RED() { return new Color(1, 0, 0, 1); }
  static get GREEN() { return new Color(0, 1, 0, 1); }
  static get BLUE() { return new Color(0, 0, 1, 1); }
  static get YELLOW() { return new Color(1, 1, 0, 1); }
  static get GRAY() { return new Color(0.75, 0.75, 0.75, 1); }
  static get DARK_GRAY() { return new Color(0.66, 0.66, 0.66, 1); }
  static get ORANGE() { return new Color(1, 0.65, 0, 1); }
  static html(s) {
    const h = s.replace("#", "");
    const n = (i) => parseInt(h.substr(i, 2), 16) / 255;
    return new Color(n(0), n(2), n(4), h.length >= 8 ? n(6) : 1);
  }
  to_html(alpha = true) {
    const b = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
    return b(this.r) + b(this.g) + b(this.b) + (alpha ? b(this.a) : "");
  }
  toString() { return `(${fmtNum(this.r)}, ${fmtNum(this.g)}, ${fmtNum(this.b)}, ${fmtNum(this.a)})`; }
}

export class Rect2 {
  constructor(x = 0, y = 0, w = 0, h = 0) {
    if (x instanceof Vector2) [x, y, w, h] = [x.x, x.y, y.x, y.y];
    this.position = new Vector2(x, y);
    this.size = new Vector2(w, h);
  }
  get end() { return new Vector2(this.position.x + this.size.x, this.position.y + this.size.y); }
  get_center() { return new Vector2(this.position.x + this.size.x / 2, this.position.y + this.size.y / 2); }
  has_point(p) { return p.x >= this.position.x && p.y >= this.position.y && p.x < this.end.x && p.y < this.end.y; }
}

// ---------------------------------------------------------------- engine <-> bridge values

/** An engine value ({type: "Vector2", args}) as a bridge value. */
// resources (resources.js): engine objects <-> GdResource
let resourceCodec = null;
export function setResourceCodec(c) {
  resourceCodec = c;
}

export function fromEngine(v) {
  if (v && typeof v === "object" && v.type && Array.isArray(v.args)) {
    if (v.type === "Vector2" || v.type === "Vector2i") return new Vector2(v.args[0], v.args[1]);
    if (v.type === "Color") return new Color(...v.args);
    if (v.type === "Rect2" || v.type === "Rect2i") return new Rect2(...v.args);
    if (v.type === "Vector3" || v.type === "Vector3i") return new Vector3(...v.args);
    // Packed*Array / Array: the stored array itself (append() changes the property)
    if (/^Packed\w+Array$|^Array$/.test(v.type)) return v.args;
  }
  if (resourceCodec && resourceCodec.is(v)) return resourceCodec.wrap(v);
  return v;
}

/** A bridge value as the engine stores it. */
export function toEngine(v) {
  if (v instanceof Vector2) return { type: "Vector2", args: [v.x, v.y] };
  if (v instanceof Color) return { type: "Color", args: [v.r, v.g, v.b, v.a] };
  if (v instanceof Rect2) return { type: "Rect2", args: [v.position.x, v.position.y, v.size.x, v.size.y] };
  if (v instanceof Vector3) return { type: "Vector3", args: [v.x, v.y, v.z] };
  if (resourceCodec) return resourceCodec.unwrap(v);
  return v;
}

// ---------------------------------------------------------------- operators

const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(6)));
const vec = (v) => v instanceof Vector2;

/** GDScript truthiness: null, false, 0, "", [], {} are false. */
export function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map) return v.size > 0;
  if (v && v.constructor === Object) return Object.keys(v).length > 0;
  return true;
}

function arith(a, b, f, name) {
  // Vector3 and Color: component by component (with a number: each component)
  for (const [C, keys] of [[Vector3, ["x", "y", "z"]], [Color, ["r", "g", "b", "a"]]]) {
    if (a instanceof C || b instanceof C) {
      const part = (v, k) => (v instanceof C ? v[k] : v);
      if (keys.some((k) => typeof part(a, k) !== "number" || typeof part(b, k) !== "number")) break;
      return new C(...keys.map((k) => f(part(a, k), part(b, k))));
    }
  }
  if (vec(a) || vec(b)) {
    const ax = vec(a) ? a.x : a, ay = vec(a) ? a.y : a, bx = vec(b) ? b.x : b, by = vec(b) ? b.y : b;
    return new Vector2(f(ax, bx), f(ay, by));
  }
  if (typeof a === "number" && typeof b === "number") return f(a, b);
  throw new TypeError(`operator ${name} not supported between ${typeName(a)} and ${typeName(b)}`);
}

export const op = {
  add(a, b) {
    if (typeof a === "string" && typeof b === "string") return a + b;
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
    return arith(a, b, (x, y) => x + y, "+");
  },
  sub: (a, b) => arith(a, b, (x, y) => x - y, "-"),
  mul(a, b) {
    if (typeof a === "string" && typeof b === "number") return a.repeat(b);
    return arith(a, b, (x, y) => x * y, "*");
  },
  // "/" between ints is an integer division in GDScript; JS numbers don't say
  // which they are: the translator passes intDiv when both sides are ints it knows of
  div: (a, b, intDiv = false) => arith(a, b, (x, y) => (intDiv ? Math.trunc(x / y) : x / y), "/"),
  mod(a, b) {
    if (typeof a === "string") return format(a, b);
    return arith(a, b, (x, y) => x % y, "%");
  },
  pow: (a, b) => a ** b,
  neg: (a) => (vec(a) ? new Vector2(-a.x, -a.y) : -a),
  eq(a, b) {
    if (a === b) return true;
    if (vec(a) && vec(b)) return a.x === b.x && a.y === b.y;
    if (a instanceof Color && b instanceof Color) return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => op.eq(x, b[i]));
    if (a && b && a.constructor === Object && b.constructor === Object) {
      const ka = Object.keys(a);
      return ka.length === Object.keys(b).length && ka.every((k) => op.eq(a[k], b[k]));
    }
    return false;
  },
  ne: (a, b) => !op.eq(a, b),
  in(a, b) {
    if (typeof b === "string") return b.includes(a);
    if (b && b.__isGdObject) return a in b; // a property of an object ("tooltip_name" in node)
    if (Array.isArray(b)) return b.some((x) => op.eq(x, a));
    if (b instanceof Map) return b.has(a);
    if (b && typeof b === "object") return Object.prototype.hasOwnProperty.call(b, a);
    return false;
  },
  /** d[k] for arrays (negative indexes count from the end), dictionaries, strings */
  get(o, k) {
    if (Array.isArray(o) || typeof o === "string") return o[k < 0 ? o.length + k : k];
    if (o instanceof Map) return o.get(k);
    if (o && typeof o.get === "function" && o.__isGdObject) return o.get(k);
    return o[k];
  },
  set(o, k, v) {
    if (Array.isArray(o)) o[k < 0 ? o.length + k : k] = v;
    else if (o instanceof Map) o.set(k, v);
    else if (o && typeof o.set === "function" && o.__isGdObject) o.set(k, v);
    else o[k] = v;
    return v;
  },
};

/** "%s / %d / %.2f" % args */
export function format(fmt, args) {
  const list = Array.isArray(args) ? args : [args];
  let i = 0;
  return fmt.replace(/%([-0-9.]*)([sdifxX%])/g, (m, flags, c) => {
    if (c === "%") return "%";
    const v = list[i++];
    if (c === "s") return str(v);
    if (c === "d" || c === "i") return String(Math.trunc(Number(v)));
    if (c === "x") return Math.trunc(v).toString(16);
    if (c === "X") return Math.trunc(v).toString(16).toUpperCase();
    const prec = /\.(\d+)/.exec(flags);
    return prec ? Number(v).toFixed(+prec[1]) : String(v);
  });
}

export function typeName(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "string") return "String";
  if (typeof v === "boolean") return "bool";
  if (Array.isArray(v)) return "Array";
  if (vec(v)) return "Vector2";
  return v.constructor && v.constructor !== Object ? v.constructor.name : "Dictionary";
}

// ---------------------------------------------------------------- methods of built-in types

const ARRAY = {
  size: (a) => a.length,
  is_empty: (a) => a.length === 0,
  append: (a, v) => void a.push(v),
  push_back: (a, v) => void a.push(v),
  push_front: (a, v) => void a.unshift(v),
  append_array: (a, b) => void a.push(...b),
  pop_back: (a) => a.pop() ?? null,
  pop_front: (a) => a.shift() ?? null,
  front: (a) => a[0] ?? null,
  back: (a) => a[a.length - 1] ?? null,
  has: (a, v) => a.some((x) => op.eq(x, v)),
  find: (a, v) => a.findIndex((x) => op.eq(x, v)),
  erase: (a, v) => {
    const i = a.findIndex((x) => op.eq(x, v));
    if (i >= 0) a.splice(i, 1);
  },
  remove_at: (a, i) => void a.splice(i, 1),
  insert: (a, i, v) => void a.splice(i, 0, v),
  clear: (a) => void (a.length = 0),
  shuffle: (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  },
  sort: (a) => void a.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)),
  sort_custom: (a, f) => void a.sort((x, y) => invoke(f, x, y) ? -1 : 1),
  reverse: (a) => void a.reverse(),
  duplicate: (a, deep = false) => (deep ? structuredClone(a) : [...a]),
  slice: (a, b, e) => a.slice(b, e === undefined || e > 2 ** 30 ? undefined : e),
  pick_random: (a) => a[Math.floor(Math.random() * a.length)] ?? null,
  count: (a, v) => a.filter((x) => op.eq(x, v)).length,
  map: (a, f) => a.map((x) => invoke(f, x)),
  filter: (a, f) => a.filter((x) => truthyinvoke(f, x)),
  any: (a, f) => a.some((x) => truthyinvoke(f, x)),
  all: (a, f) => a.every((x) => truthyinvoke(f, x)),
  max: (a) => (a.length ? Math.max(...a) : null),
  min: (a) => (a.length ? Math.min(...a) : null),
};
// a Callable or a JS function (a translated lambda)
const invoke = (f, ...a) => (typeof f === "function" ? f(...a) : f.call(...a));

const STRING = {
  length: (s) => s.length,
  is_empty: (s) => s.length === 0,
  begins_with: (s, p) => s.startsWith(p),
  ends_with: (s, p) => s.endsWith(p),
  to_upper: (s) => s.toUpperCase(),
  to_lower: (s) => s.toLowerCase(),
  strip_edges: (s) => s.trim(),
  substr: (s, from, len = -1) => (len < 0 ? s.slice(from) : s.substr(from, len)),
  find: (s, w, from = 0) => s.indexOf(w, from),
  contains: (s, w) => s.includes(w),
  replace: (s, a, b) => s.split(a).join(b),
  split: (s, d = "", allowEmpty = true) => s.split(d).filter((x) => allowEmpty || x !== ""),
  to_int: (s) => parseInt(s, 10) || 0,
  to_float: (s) => parseFloat(s) || 0,
  is_valid_int: (s) => /^[-+]?\d+$/.test(s),
  left: (s, n) => s.slice(0, n),
  right: (s, n) => s.slice(-n),
  trim_prefix: (s, p) => (s.startsWith(p) ? s.slice(p.length) : s),
  trim_suffix: (s, p) => (s.endsWith(p) ? s.slice(0, -p.length) : s),
  capitalize: (s) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  format: (s, d) => s.replace(/\{(\w+)\}/g, (m, k) => (k in d ? str(d[k]) : m)),
  unicode_at: (s, i) => s.codePointAt(i),
  path_join: (s, p) => s.replace(/\/$/, "") + "/" + p,
  join: (sep, parts) => [...parts].map((p) => str(p)).join(sep),
  to_snake_case: (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase(),
  to_camel_case: (s) => s.replace(/_+([a-z0-9])/g, (_, c) => c.toUpperCase()).replace(/^[A-Z]/, (c) => c.toLowerCase()),
  to_pascal_case: (s) => s.replace(/(^|_+)([a-z0-9])/g, (_, __, c) => c.toUpperCase()),
  get_file: (s) => s.slice(s.lastIndexOf("/") + 1),
  get_base_dir: (s) => s.slice(0, s.lastIndexOf("/")),
  get_extension: (s) => (s.includes(".") ? s.slice(s.lastIndexOf(".") + 1) : ""),
};
const DICT = {
  size: (d) => Object.keys(d).length,
  is_empty: (d) => Object.keys(d).length === 0,
  has: (d, k) => Object.prototype.hasOwnProperty.call(d, k),
  get: (d, k, def = null) => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : def),
  keys: (d) => Object.keys(d),
  values: (d) => Object.values(d),
  erase: (d, k) => {
    const had = Object.prototype.hasOwnProperty.call(d, k);
    delete d[k];
    return had;
  },
  clear: (d) => Object.keys(d).forEach((k) => delete d[k]),
  merge: (d, o, overwrite = false) => {
    for (const [k, v] of Object.entries(o)) if (overwrite || !(k in d)) d[k] = v;
  },
  duplicate: (d, deep = false) => (deep ? structuredClone(d) : { ...d }),
};
export const BUILTIN_METHODS = { Array: Object.keys(ARRAY), String: Object.keys(STRING), Dictionary: Object.keys(DICT) };

/** obj.method(args) on a value whose type isn't known when translating. */
export function call(o, name, ...args) {
  if (Array.isArray(o) && ARRAY[name]) return ARRAY[name](o, ...args);
  if (typeof o === "string" && STRING[name]) return STRING[name](o, ...args);
  if (o && o.constructor === Object && DICT[name] && typeof o[name] !== "function") return DICT[name](o, ...args);
  if (o === null || o === undefined) throw new TypeError(`call to ${name}() on null`);
  const f = o[name];
  if (typeof f !== "function") throw new TypeError(`${typeName(o)} has no method ${name}() (not in the bridge yet)`);
  return f.apply(o, args);
}

/** for x in v: arrays, dictionaries (keys), strings, ints (0..n-1). */
export function iter(v) {
  if (typeof v === "number") return Array.from({ length: Math.max(0, Math.trunc(v)) }, (_, i) => i);
  if (Array.isArray(v) || typeof v === "string") return v;
  if (v instanceof Map) return [...v.keys()];
  if (v && typeof v === "object") return Object.keys(v);
  return [];
}

// ---------------------------------------------------------------- global functions

/** str(): GDScript's text for a value. */
export function str(...vs) {
  return vs
    .map((v) => {
      if (v === null || v === undefined) return "<null>";
      if (typeof v === "boolean") return v ? "true" : "false";
      if (typeof v === "number") return fmtNum(v);
      if (Array.isArray(v)) return `[${v.map((x) => (typeof x === "string" ? `"${x}"` : str(x))).join(", ")}]`;
      if (typeof v === "string") return v;
      if (v && v.constructor === Object) return `{ ${Object.entries(v).map(([k, x]) => `"${k}": ${str(x)}`).join(", ")} }`;
      return String(v);
    })
    .join("");
}

export const GLOBALS = {
  // math
  abs: Math.abs, absf: Math.abs, absi: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, atan2: Math.atan2, sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp, log: Math.log,
  floor: Math.floor, floorf: Math.floor, floori: Math.floor, ceil: Math.ceil, ceilf: Math.ceil, ceili: Math.ceil,
  round: Math.round, roundf: Math.round, roundi: Math.round, sign: Math.sign, signf: Math.sign, signi: Math.sign,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a), mini: Math.min, maxi: Math.max, minf: Math.min, maxf: Math.max,
  clamp: (v, a, b) => Math.min(Math.max(v, a), b), clampi: (v, a, b) => Math.min(Math.max(v, a), b), clampf: (v, a, b) => Math.min(Math.max(v, a), b),
  lerp: (a, b, t) => (vec(a) ? a.lerp(b, t) : a + (b - a) * t), lerpf: (a, b, t) => a + (b - a) * t,
  inverse_lerp: (a, b, v) => (v - a) / (b - a),
  fmod: (a, b) => a % b, fposmod: (a, b) => ((a % b) + b) % b, posmod: (a, b) => ((a % b) + b) % b,
  wrapi: (v, a, b) => a + ((((v - a) % (b - a)) + (b - a)) % (b - a)), wrapf: (v, a, b) => a + ((((v - a) % (b - a)) + (b - a)) % (b - a)),
  deg_to_rad: (d) => (d * Math.PI) / 180, rad_to_deg: (r) => (r * 180) / Math.PI,
  move_toward: (a, b, d) => (Math.abs(b - a) <= d ? b : a + Math.sign(b - a) * d),
  is_equal_approx: (a, b) => Math.abs(a - b) < 1e-5, is_zero_approx: (a) => Math.abs(a) < 1e-5,
  snapped: (v, s) => (s ? Math.round(v / s) * s : v),
  PI: Math.PI, TAU: Math.PI * 2, INF: Infinity, NAN: NaN,
  // random
  randomize: () => {}, seed: () => {},
  randi: () => Math.floor(Math.random() * 4294967296), randf: () => Math.random(),
  randi_range: (a, b) => a + Math.floor(Math.random() * (b - a + 1)), randf_range: (a, b) => a + Math.random() * (b - a),
  // types
  str, int: (v) => (typeof v === "string" ? parseInt(v, 10) || 0 : Math.trunc(Number(v) || 0)), float: (v) => Number(v) || 0,
  bool: (v) => truthy(v), String: (v) => str(v),
  typeof: (v) => TYPE_OF[typeName(v)] ?? 0,
  len: (v) => (v && v.length !== undefined ? v.length : Object.keys(v || {}).length),
  range: (a, b, s = 1) => {
    if (b === undefined) [a, b] = [0, a];
    const out = [];
    for (let i = a; s > 0 ? i < b : i > b; i += s) out.push(i);
    return out;
  },
  is_instance_valid: (o) => !!o && !o.__freed,
  load: () => null, // the bridge replaces it (resources need the game)
  instance_from_id: () => null,
  print: (...a) => console.log(str(...a)),
  prints: (...a) => console.log(a.map((x) => str(x)).join(" ")),
  printerr: (...a) => console.warn(str(...a)),
  push_error: (...a) => console.error(str(...a)),
  push_warning: (...a) => console.warn(str(...a)),
  Vector2: (x, y) => new Vector2(x, y), Color: (r, g, b, a) => new Color(r, g, b, a), Rect2: (...a) => new Rect2(...a),
  Vector2i: (x, y) => (x instanceof Vector2 ? new Vector2(Math.trunc(x.x), Math.trunc(x.y)) : new Vector2(Math.trunc(x || 0), Math.trunc(y || 0))),
  Rect2i: (...a) => new Rect2(...a.map((v) => (typeof v === "number" ? Math.trunc(v) : v))),
  Vector3: (x, y, z) => new Vector3(x, y, z),
  Array: (a = []) => [...a], Dictionary: (d = {}) => ({ ...d }),
  // packed arrays are arrays here
  PackedStringArray: (a = []) => [...a], PackedInt32Array: (a = []) => [...a], PackedInt64Array: (a = []) => [...a],
  PackedFloat32Array: (a = []) => [...a], PackedFloat64Array: (a = []) => [...a], PackedVector2Array: (a = []) => [...a],
  snappedf: (v, step) => (step ? Math.round(v / step) * step : v),
  snappedi: (v, step) => (step ? Math.round(v / step) * step : Math.round(v)),
  // Node notifications (_notification(what))
  NOTIFICATION_READY: 13, NOTIFICATION_TRANSLATION_CHANGED: 2010,
};
const TYPE_OF = { null: 0, bool: 1, int: 2, float: 3, String: 4, Vector2: 5, Rect2: 7, Color: 20, Dictionary: 27, Array: 28 };
for (const [k, v] of Object.entries({ TYPE_NIL: 0, TYPE_BOOL: 1, TYPE_INT: 2, TYPE_FLOAT: 3, TYPE_STRING: 4, TYPE_VECTOR2: 5, TYPE_RECT2: 7, TYPE_COLOR: 20, TYPE_OBJECT: 24, TYPE_DICTIONARY: 27, TYPE_ARRAY: 28 })) GLOBALS[k] = v;
// constants of @GlobalScope used in game scripts
Object.assign(GLOBALS, {
  CONNECT_ONE_SHOT: 4, OK: 0, FAILED: 1, ERR_FILE_NOT_FOUND: 7, ERR_CANT_OPEN: 19, ERR_DOES_NOT_EXIST: 33,
  MOUSE_BUTTON_LEFT: 1, MOUSE_BUTTON_RIGHT: 2, MOUSE_BUTTON_MIDDLE: 3, MOUSE_BUTTON_WHEEL_UP: 4, MOUSE_BUTTON_WHEEL_DOWN: 5,
  HORIZONTAL_ALIGNMENT_LEFT: 0, HORIZONTAL_ALIGNMENT_CENTER: 1, HORIZONTAL_ALIGNMENT_RIGHT: 2, HORIZONTAL_ALIGNMENT_FILL: 3,
  VERTICAL_ALIGNMENT_TOP: 0, VERTICAL_ALIGNMENT_CENTER: 1, VERTICAL_ALIGNMENT_BOTTOM: 2,
  // Node.process_mode (also as Node.PROCESS_MODE_*)
  PROCESS_MODE_INHERIT: 0, PROCESS_MODE_PAUSABLE: 1, PROCESS_MODE_WHEN_PAUSED: 2, PROCESS_MODE_ALWAYS: 3, PROCESS_MODE_DISABLED: 4,
  TYPE_VECTOR2I: 6, TYPE_RECT2I: 8, TYPE_VECTOR3: 9, TYPE_STRING_NAME: 21, TYPE_NODE_PATH: 22,
});

/** Godot keycodes (KEY_*) and the browser's KeyboardEvent.key for each. */
export const KEYS = {
  ESCAPE: [4194305, "Escape"], TAB: [4194306, "Tab"], BACKSPACE: [4194308, "Backspace"], ENTER: [4194309, "Enter"], KP_ENTER: [4194310, null],
  INSERT: [4194311, "Insert"], DELETE: [4194312, "Delete"], PAUSE: [4194313, "Pause"], HOME: [4194317, "Home"], END: [4194318, "End"],
  LEFT: [4194319, "ArrowLeft"], UP: [4194320, "ArrowUp"], RIGHT: [4194321, "ArrowRight"], DOWN: [4194322, "ArrowDown"],
  PAGEUP: [4194323, "PageUp"], PAGEDOWN: [4194324, "PageDown"], SHIFT: [4194325, "Shift"], CTRL: [4194326, "Control"], META: [4194327, "Meta"], ALT: [4194328, "Alt"],
  SPACE: [32, " "],
};
for (let i = 1; i <= 12; i++) KEYS[`F${i}`] = [4194331 + i, `F${i}`];
for (let c = 65; c <= 90; c++) KEYS[String.fromCharCode(c)] = [c, String.fromCharCode(c + 32)];
for (let d = 0; d <= 9; d++) KEYS[String(d)] = [48 + d, String(d)];
for (const [k, [code]] of Object.entries(KEYS)) GLOBALS[`KEY_${k}`] = code;
/** The Godot keycode of a browser key event (0 if unknown). */
export function keycodeOf(e) {
  const k = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
  for (const [code, dom] of Object.values(KEYS)) if (dom === k) return code;
  return e.key && e.key.length === 1 ? e.key.toUpperCase().codePointAt(0) : 0;
}
for (const C of [Vector2, Vector3, Color, Rect2]) C.prototype.__isGdValue = true;
/** A value type (copied on assignment in GDScript): Vector2, Color, Rect2... */
export const isValue = (v) => !!(v && v.__isGdValue);
