// Helpers to read Godot values as they come from the exporter
// ({type: "Vector2", args: [x, y]} and friends).

export function vec2(v, dx = 0, dy = 0) {
  if (v && (v.type === "Vector2" || v.type === "Vector2i")) return { x: v.args[0], y: v.args[1] };
  return { x: dx, y: dy };
}

/** PackedVector2Array(x0, y0, x1, y1...) -> [{x, y}...] */
export function points(v) {
  const a = v && v.args ? v.args : [];
  const out = [];
  for (let i = 0; i + 1 < a.length; i += 2) out.push({ x: a[i], y: a[i + 1] });
  return out;
}

/** Packed*Array(...) / plain array -> array */
export function list(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.args)) return v.args;
  return [];
}

export function rect2(v) {
  const a = v && v.args ? v.args : [0, 0, 0, 0];
  return { x: a[0], y: a[1], w: a[2], h: a[3] };
}

export function color(v, def = [1, 1, 1, 1]) {
  const a = v && v.type === "Color" ? v.args : def;
  return { r: a[0], g: a[1], b: a[2], a: a[3] ?? 1 };
}

export function cssColor(v) {
  const c = color(v);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;
}

/** NodePath("a/b:prop") -> "a/b:prop" */
export function nodePath(v) {
  return v && v.type === "NodePath" ? v.args[0] : typeof v === "string" ? v : "";
}

/** {"$res": path} -> path */
export function resPath(v) {
  return v && typeof v === "object" && v.$res ? v.$res : null;
}
