// GPUParticles2D with a ParticleProcessMaterial, on the CPU: the part of it
// that 2D adventures use (emission point / sphere / box, direction, spread,
// initial velocity, gravity, damping, angle, scale and their curves, color and
// color ramp, lifetime randomness, preprocess, speed scale, one shot).
// Particles live in the node's own coordinates (local_coords).
import { vec2, color as readColor } from "./values.js";

const rnd = (a, b) => a + Math.random() * (b - a);
const num = (v, d) => (typeof v === "number" ? v : d);
const vec3 = (v, d) => (v && v.args ? { x: v.args[0], y: v.args[1] } : d);

/** Curve._data -> (x) => y, cubic Hermite between points (Curve.sample). */
export function curveSampler(curve) {
  const d = curve && curve.props && curve.props._data;
  if (!Array.isArray(d) || !d.length) return null;
  const pts = [];
  for (let i = 0; i + 4 < d.length; i += 5) {
    const p = vec2(d[i]);
    pts.push({ x: p.x, y: p.y, lt: d[i + 1] || 0, rt: d[i + 2] || 0 });
  }
  if (!pts.length) return null;
  return (x) => {
    if (x <= pts[0].x) return pts[0].y;
    const last = pts[pts.length - 1];
    if (x >= last.x) return last.y;
    let i = 0;
    while (i < pts.length - 2 && x > pts[i + 1].x) i++;
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x;
    if (dx <= 0) return a.y;
    const t = (x - a.x) / dx, t2 = t * t, t3 = t2 * t;
    const m0 = a.rt * dx, m1 = b.lt * dx;
    return (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * m1;
  };
}

/** Gradient -> (x) => {r, g, b, a} (linear). */
export function gradientSampler(gradient) {
  const p = gradient && gradient.props;
  if (!p) return null;
  const cols = p.colors && (p.colors.args || p.colors);
  const offs = (p.offsets && (p.offsets.args || p.offsets)) || [0, 1];
  if (!Array.isArray(cols)) return (x) => ({ r: 1 - x, g: 1 - x, b: 1 - x, a: 1 }); // default: white -> black
  const stops = offs.map((o, i) => ({ o, c: { r: cols[i * 4], g: cols[i * 4 + 1], b: cols[i * 4 + 2], a: cols[i * 4 + 3] } })).filter((s) => s.c.r !== undefined);
  return (x) => {
    if (!stops.length) return { r: 1, g: 1, b: 1, a: 1 };
    if (x <= stops[0].o) return stops[0].c;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (x <= b.o) {
        const t = b.o > a.o ? (x - a.o) / (b.o - a.o) : 0;
        return { r: a.c.r + (b.c.r - a.c.r) * t, g: a.c.g + (b.c.g - a.c.g) * t, b: a.c.b + (b.c.b - a.c.b) * t, a: a.c.a + (b.c.a - a.c.a) * t };
      }
    }
    return stops[stops.length - 1].c;
  };
}

// the process material as plain numbers and samplers (once per node)
function config(node) {
  const m = (node.props.process_material && node.props.process_material.props) || {};
  const tex = (t) => (t && t.props ? t.props : null);
  const dir = vec3(m.direction, { x: 1, y: 0 });
  const ramp = tex(m.color_ramp);
  return {
    amount: Math.max(1, node.props.amount ?? 8),
    lifetime: num(node.props.lifetime, 1),
    speedScale: num(node.props.speed_scale, 1),
    oneShot: !!node.props.one_shot,
    lifeRandom: num(m.lifetime_randomness, 0),
    shape: num(m.emission_shape, 0), // 0 point, 1 sphere, 2 sphere surface, 3 box
    radius: num(m.emission_sphere_radius, 1),
    box: vec3(m.emission_box_extents, { x: 1, y: 1 }),
    dirAngle: Math.atan2(dir.y, dir.x),
    spread: (num(m.spread, 45) * Math.PI) / 180,
    v0: [num(m.initial_velocity_min, 0), num(m.initial_velocity_max, num(m.initial_velocity_min, 0))],
    gravity: vec3(m.gravity, { x: 0, y: 98 }),
    damping: [num(m.damping_min, 0), num(m.damping_max, num(m.damping_min, 0))],
    angle: [num(m.angle_min, 0), num(m.angle_max, num(m.angle_min, 0))],
    angleCurve: curveSampler(tex(m.angle_curve) && tex(m.angle_curve).curve),
    scale: [num(m.scale_min, 1), num(m.scale_max, num(m.scale_min, 1))],
    scaleCurve: curveSampler(tex(m.scale_curve) && tex(m.scale_curve).curve),
    color: readColor(m.color),
    ramp: ramp ? gradientSampler(ramp.gradient) : null,
  };
}

function spawn(c) {
  let x = 0, y = 0;
  if (c.shape === 1 || c.shape === 2) {
    const a = Math.random() * 2 * Math.PI, r = c.shape === 1 ? c.radius * Math.sqrt(Math.random()) : c.radius;
    x = Math.cos(a) * r;
    y = Math.sin(a) * r;
  } else if (c.shape === 3) {
    x = rnd(-c.box.x, c.box.x);
    y = rnd(-c.box.y, c.box.y);
  }
  const a = c.dirAngle + rnd(-c.spread, c.spread), v = rnd(c.v0[0], c.v0[1]);
  return {
    x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
    age: 0, life: c.lifetime * (1 - c.lifeRandom * Math.random()),
    angle: rnd(c.angle[0], c.angle[1]), scale: rnd(c.scale[0], c.scale[1]), damping: rnd(c.damping[0], c.damping[1]),
  };
}

function step(st, c, dt) {
  const emitting = st.node.props.emitting !== false;
  // `amount` particles per `lifetime`, evenly
  if (emitting) {
    st.toEmit += (dt * c.amount) / c.lifetime;
    while (st.toEmit >= 1) {
      st.toEmit -= 1;
      if (st.list.length < c.amount) st.list.push(spawn(c));
      if (c.oneShot && ++st.emitted >= c.amount) {
        st.node.props.emitting = false;
        break;
      }
    }
  }
  for (const p of st.list) {
    p.age += dt;
    p.vx += c.gravity.x * dt;
    p.vy += c.gravity.y * dt;
    if (p.damping) {
      const sp = Math.hypot(p.vx, p.vy), k = sp > 0 ? Math.max(sp - p.damping * dt, 0) / sp : 0;
      p.vx *= k;
      p.vy *= k;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  st.list = st.list.filter((p) => p.age < p.life);
}

/** One frame of a GPUParticles2D (from Escoria.update). */
export function advanceParticles(node, dt) {
  let st = node.state.particles;
  if (!st) {
    st = node.state.particles = { node, conf: config(node), list: [], toEmit: 0, emitted: 0 };
    // preprocess: as if it had been running that long
    const pre = num(node.props.preprocess, 0);
    for (let t = 0; t < pre; t += 1 / 30) step(st, st.conf, (1 / 30) * st.conf.speedScale);
  }
  step(st, st.conf, dt * st.conf.speedScale);
}

// a black version of a picture, to darken particles toward black (color ramps)
const shadows = new WeakMap();
function shadowOf(img) {
  if (!shadows.has(img)) {
    try {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const cx = c.getContext("2d");
      cx.drawImage(img, 0, 0);
      cx.globalCompositeOperation = "source-in";
      cx.fillStyle = "#000";
      cx.fillRect(0, 0, c.width, c.height);
      shadows.set(img, c);
    } catch {
      shadows.set(img, null);
    }
  }
  return shadows.get(img);
}

/** Draws the particles with the node's transform already set on ctx. */
export function drawParticles(ctx, game, node, alpha) {
  const st = node.state.particles;
  if (!st || !st.list.length) return;
  const c = st.conf;
  const tex = game.texture(node.props.texture);
  const base = ctx.getTransform();
  for (const p of st.list) {
    const t = Math.min(p.age / p.life, 1);
    const s = p.scale * (c.scaleCurve ? c.scaleCurve(t) : 1);
    if (s <= 0) continue;
    const ang = ((p.angle * (c.angleCurve ? c.angleCurve(t) : 1)) * Math.PI) / 180;
    const col = c.ramp ? c.ramp(t) : { r: 1, g: 1, b: 1, a: 1 };
    const a = alpha * col.a * c.color.a;
    if (a <= 0) continue;
    ctx.setTransform(base);
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    ctx.scale(s, s);
    ctx.globalAlpha = a;
    if (!tex) {
      ctx.fillStyle = `rgb(${255 * col.r * c.color.r},${255 * col.g * c.color.g},${255 * col.b * c.color.b})`;
      ctx.fillRect(-0.5, -0.5, 1, 1);
      continue;
    }
    ctx.drawImage(tex.img, tex.sx, tex.sy, tex.sw, tex.sh, -tex.sw / 2, -tex.sh / 2, tex.sw, tex.sh);
    // the color's brightness: a black copy over it
    const dark = 1 - (col.r * c.color.r + col.g * c.color.g + col.b * c.color.b) / 3;
    const sh = dark > 0.01 && shadowOf(tex.img);
    if (sh) {
      ctx.globalAlpha = a * dark;
      ctx.drawImage(sh, tex.sx, tex.sy, tex.sw, tex.sh, -tex.sw / 2, -tex.sh / 2, tex.sw, tex.sh);
    }
  }
  ctx.setTransform(base);
}
