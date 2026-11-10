// AnimationPlayer (value tracks) and AnimatedSprite2D frame advance.
import { list, nodePath } from "./values.js";

/** The animations of an AnimationPlayer node: name -> Animation resource. */
export function animations(player) {
  const out = {};
  // libraries = {"": lib} (Godot 4.0-4.3) or libraries/<name> = lib (Godot 4.4+);
  // Godot 3's anims/<name> = animation, which Godot 4 still loads
  const libs = { ...(player.props.libraries || {}) };
  for (const [k, v] of Object.entries(player.props)) {
    if (k.startsWith("libraries/")) libs[k.slice(10)] = v;
    else if (k.startsWith("anims/") && v) out[k.slice(6)] = v;
  }
  for (const [libName, lib] of Object.entries(libs)) {
    const data = (lib && lib.props && lib.props._data) || {};
    for (const [name, anim] of Object.entries(data)) out[libName ? `${libName}/${name}` : name] = anim;
  }
  return out;
}

/** Tracks of an Animation resource: [{type, path, keys}] */
export function tracks(anim) {
  const t = [];
  for (const [k, v] of Object.entries(anim.props)) {
    const m = /^tracks\/(\d+)\/(\w+)$/.exec(k);
    if (!m) continue;
    (t[+m[1]] ||= {})[m[2]] = v;
  }
  return t.filter(Boolean);
}

// Godot's ease(x, c): the curve of a key's transition
function ease(x, c) {
  if (c > 0) return c < 1 ? 1 - Math.pow(1 - x, 1 / c) : Math.pow(x, c);
  if (c < 0) return x < 0.5 ? Math.pow(x * 2, -c) * 0.5 : (1 - Math.pow(1 - (x - 0.5) * 2, -c)) * 0.5 + 0.5;
  return 0;
}

// a value between a and b (numbers, Vector2, Color...: {type, args}); null if they don't mix
function mix(a, b, t) {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * t;
  if (a && b && a.type && a.type === b.type && Array.isArray(a.args) && a.args.length === b.args.length && a.args.every((x) => typeof x === "number")) {
    return { type: a.type, args: a.args.map((x, i) => x + (b.args[i] - x) * t) };
  }
  return null;
}

/**
 * Applies an animation at time `time` (seconds): "value" tracks. Continuous
 * tracks (update 0) with numbers / vectors / colors are interpolated between
 * their keys (interp: 0 nearest, 1 linear, 2 cubic, taken as linear; each
 * key's transition is an ease() curve); the rest take the last key at or
 * before `time`. Paths are relative to the player's root node (its parent by
 * default).
 */
export function applyAnimation(player, anim, time = 0) {
  const root = player.getNode(nodePath(player.props.root_node) || "..");
  for (const tr of tracks(anim)) {
    if (tr.enabled === false) continue;
    if (tr.type === "bezier") {
      applyBezier(root, tr, time);
      continue;
    }
    if (tr.type !== "value") continue;
    const [path, prop] = nodePath(tr.path).split(":");
    const target = root && root.getNode(path);
    if (!target || !prop) continue;
    const times = list(tr.keys.times);
    const values = tr.keys.values;
    let i = -1;
    while (i + 1 < times.length && times[i + 1] <= time + 1e-6) i++;
    if (i < 0) i = 0;
    let v = values[i];
    const discrete = (tr.keys.update ?? 0) !== 0 || tr.interp === 0;
    if (!discrete && i + 1 < times.length && times[i + 1] > times[i] && time > times[i]) {
      const trans = list(tr.keys.transitions)[i] ?? 1;
      const m = mix(values[i], values[i + 1], ease((time - times[i]) / (times[i + 1] - times[i]), trans));
      if (m !== null) v = m;
    }
    target.props[prop] = v;
  }
}

// a cubic Bezier between two keys (time, value) with their handles, at time t
function bezierAt(t0, v0, ox, oy, t1, v1, ix, iy, t) {
  const x = [t0, t0 + ox, t1 + ix, t1], y = [v0, v0 + oy, v1 + iy, v1];
  const at = (p, s) => (1 - s) ** 3 * p[0] + 3 * (1 - s) ** 2 * s * p[1] + 3 * (1 - s) * s * s * p[2] + s ** 3 * p[3];
  // the curve's parameter whose x is t (x grows with s between the keys)
  let lo = 0, hi = 1;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (at(x, mid) < t) lo = mid;
    else hi = mid;
  }
  return at(y, (lo + hi) / 2);
}

/**
 * A "bezier" track (one number, often a component: "node:position:y"):
 * keys.points has 5 numbers per key (value, in handle x/y, out handle x/y,
 * the handles relative to the key).
 */
function applyBezier(root, tr, time) {
  const parts = nodePath(tr.path).split(":");
  const target = root && root.getNode(parts[0]);
  if (!target || parts.length < 2) return;
  const times = list(tr.keys.times), pts = list(tr.keys.points);
  if (!times.length) return;
  const key = (i) => ({ t: times[i], v: pts[i * 5], ix: pts[i * 5 + 1], iy: pts[i * 5 + 2], ox: pts[i * 5 + 3], oy: pts[i * 5 + 4] });
  let i = -1;
  while (i + 1 < times.length && times[i + 1] <= time + 1e-6) i++;
  let v;
  if (i < 0) v = key(0).v;
  else if (i >= times.length - 1) v = key(times.length - 1).v;
  else {
    const a = key(i), b = key(i + 1);
    v = bezierAt(a.t, a.v, a.ox, a.oy, b.t, b.v, b.ix, b.iy, time);
  }
  const [prop, sub] = [parts[1], parts[2]];
  if (!sub) {
    target.props[prop] = v;
    return;
  }
  // a component of a vector / color
  const IDX = { x: 0, y: 1, z: 2, r: 0, g: 1, b: 2, a: 3 };
  const cur = target.props[prop];
  const type = cur && cur.type ? cur.type : sub === "r" || sub === "g" || sub === "b" || sub === "a" ? "Color" : "Vector2";
  const args = cur && cur.args ? [...cur.args] : type === "Color" ? [1, 1, 1, 1] : [0, 0];
  args[IDX[sub] ?? 0] = v;
  target.props[prop] = { type, args };
}

/** AnimatedSprite2D: current animation from its SpriteFrames. */
export function spriteAnimation(node) {
  const frames = node.props.sprite_frames;
  const name = node.state.animation ?? node.props.animation ?? "default";
  const anims = (frames && frames.props && frames.props.animations) || [];
  return anims.find((a) => a.name === name) || null;
}

/** Advances an AnimatedSprite2D that is playing (Godot: speed fps, frame duration multiplies). */
export function advanceSprite(node, dt) {
  const st = node.state;
  if (st.playing === undefined) {
    st.playing = !!node.props.autoplay;
    if (node.props.autoplay) st.animation = node.props.autoplay;
    st.frame = node.props.frame || 0;
    st.elapsed = 0;
  }
  if (!st.playing) return;
  const anim = spriteAnimation(node);
  if (!anim || !anim.frames.length) return;
  const fps = (anim.speed || 5) * (node.props.speed_scale ?? 1);
  if (fps <= 0) return;
  st.elapsed += dt;
  const step = st.backwards ? -1 : 1;
  for (;;) {
    const dur = (anim.frames[st.frame]?.duration ?? 1) / fps;
    if (st.elapsed < dur) break;
    st.elapsed -= dur;
    const next = st.frame + step;
    if (next >= 0 && next < anim.frames.length) st.frame = next;
    else if (anim.loop ?? true) // (a .tscn may say "loop": 0)
      st.frame = step > 0 ? 0 : anim.frames.length - 1;
    else {
      st.playing = false;
      const cbs = st.onFinished || [];
      st.onFinished = [];
      cbs.forEach((f) => f());
      break;
    }
  }
}
