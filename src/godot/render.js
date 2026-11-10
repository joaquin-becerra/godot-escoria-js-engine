// Canvas 2D drawing of a node tree, the way Godot orders CanvasItems:
// by z_index (relative to the parent unless z_as_relative = false), then in
// tree order. Supports Sprite2D and AnimatedSprite2D for now.
import { vec2, rect2, color, points } from "./values.js";
import { spriteAnimation } from "./animation.js";
import { CONTROL_TYPES, DRAWN_CONTROLS, controlRect, drawControl, mouseFilter } from "./controls.js";
import { drawShaded, hasShader } from "./shaders.js";
import { drawParticles } from "./particles.js";

// node types drawn by drawOwn (besides the drawn Controls)
const DRAWN_NODES = new Set(["Sprite2D", "AnimatedSprite2D", "Polygon2D", "Line2D", "GPUParticles2D"]);

// 2D affine transform [a, b, c, d, e, f] (same layout as canvas setTransform)
export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m, p) {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

/** Local transform of a Node2D (position, rotation, scale). */
export function localTransform(node) {
  if (CONTROL_TYPES.has(node.type)) {
    // Controls: their rectangle's position (anchors + offsets) and scale
    const r = controlRect(node);
    const s = vec2(node.props.scale, 1, 1);
    return [s.x, 0, 0, s.y, r.x, r.y];
  }
  const p = vec2(node.props.position);
  const s = vec2(node.props.scale, 1, 1);
  const r = node.props.rotation || 0;
  const cos = Math.cos(r), sin = Math.sin(r);
  return [cos * s.x, sin * s.x, -sin * s.y, cos * s.y, p.x, p.y];
}

// node types that don't take part in 2D drawing or transforms
// A CanvasLayer is a canvas of its own: with layer 0 it's still drawn over
// the main canvas (layer 0 too), whatever the z_index of what's in each
const canvasLayer = (l) => (l === 0 ? 0.5 : l);
const NOT_CANVAS = new Set(["Node", "AnimationPlayer", "Timer", "AudioStreamPlayer", "AudioStreamPlayer2D"]);

export function globalTransform(node) {
  let m = IDENTITY;
  const chain = [];
  for (let n = node; n; n = n.parent) chain.unshift(n);
  for (const n of chain) if (!NOT_CANVAS.has(n.type)) m = multiply(m, localTransform(n));
  return m;
}

export function isVisible(node) {
  for (let n = node; n; n = n.parent) if (n.props.visible === false) return false;
  return true;
}

/**
 * Drawable items of a tree, sorted for drawing: [{node, xf, z}].
 * `base` is the transform of `root`'s parent (camera, screen scale...).
 */
// custom drawing (a script's _draw / draw signal): set by the GDScript bridge
let customDraw = null;
export function setCustomDraw(f) {
  customDraw = f;
}

export function collect(root, base = IDENTITY, { allControls = false, screen = IDENTITY } = {}) {
  const items = [];
  let order = 0;
  let layer = 0; // CanvasLayer.layer of the branch being visited
  // clip: the rectangles (ScrollContainer, clip_contents) the node is drawn inside, [{xf, w, h}]
  const visit = (node, xf, z, clip) => {
    if (node.props.visible === false) return;
    if (node.type === "CanvasLayer") {
      // screen space (not the camera), its own offset / scale; drawn by layer
      const saved = layer;
      layer = canvasLayer(node.props.layer ?? 1);
      const o = vec2(node.props.offset), s = vec2(node.props.scale, 1, 1);
      for (const c of node.children) visit(c, multiply(screen, [s.x, 0, 0, s.y, o.x, o.y]), 0, null);
      layer = saved;
      return;
    }
    if (node.type === "ParallaxBackground") {
      // a CanvasLayer that scrolls with the camera: ParallaxBackground._update_scroll()
      // and ParallaxLayer.set_base_offset_and_scale() (Godot 4)
      const saved = layer;
      layer = canvasLayer(node.props.layer ?? -100);
      const bo = vec2(node.props.scroll_base_offset), bs = vec2(node.props.scroll_base_scale, 1, 1);
      const ofs = { x: bo.x + base[4] * bs.x, y: bo.y + base[5] * bs.y }; // scroll_offset: the canvas origin
      for (const c of node.children) {
        if (c.type !== "ParallaxLayer") {
          visit(c, screen, 0, null);
          continue;
        }
        if (c.props.visible === false) continue;
        const ms = vec2(c.props.motion_scale, 1, 1), mo = vec2(c.props.motion_offset), mir = vec2(c.props.motion_mirroring);
        const sc = vec2(c.props.scale, 1, 1), op = vec2(c.props.position);
        let x = ofs.x * ms.x + mo.x + op.x, y = ofs.y * ms.y + mo.y + op.y;
        if (mir.x) x -= mir.x * Math.ceil(x / mir.x);
        if (mir.y) y -= mir.y * Math.ceil(y / mir.y);
        // the mirrored copies (canvas item mirroring): enough to cover the screen
        const xs = mir.x ? [x, x + mir.x, x + 2 * mir.x] : [x], ys = mir.y ? [y, y + mir.y, y + 2 * mir.y] : [y];
        for (const cy of ys) for (const cx of xs) {
          const xf = multiply(screen, [sc.x, 0, 0, sc.y, cx, cy]);
          for (const g of c.children) visit(g, xf, 0, null);
        }
      }
      layer = saved;
      return;
    }
    const canvas = !NOT_CANVAS.has(node.type);
    if (canvas) {
      xf = multiply(xf, localTransform(node));
      const zi = node.props.z_index || 0;
      z = node.props.z_as_relative === false ? zi : z + zi;
    }
    if (DRAWN_NODES.has(node.type) || DRAWN_CONTROLS.has(node.type) || node.state.customDraw || (allControls && CONTROL_TYPES.has(node.type))) items.push({ node, xf, z, clip, layer, order: order++ });
    if (CONTROL_TYPES.has(node.type) && (node.type === "ScrollContainer" || node.props.clip_contents)) {
      const r = controlRect(node);
      clip = [...(clip || []), { xf, w: r.w, h: r.h }];
    }
    for (const c of node.children) visit(c, xf, z, clip);
  };
  visit(root, base, 0, null);
  items.sort((a, b) => a.layer - b.layer || a.z - b.z || a.order - b.order);
  return items;
}

/** Picture and source rectangle of a sprite node, or null: {img, sx, sy, sw, sh}. */
export function spriteFrame(game, node) {
  let tex;
  if (node.type === "AnimatedSprite2D") {
    const anim = spriteAnimation(node);
    if (!anim || !anim.frames.length) return null;
    const f = anim.frames[Math.min(node.state.frame ?? node.props.frame ?? 0, anim.frames.length - 1)];
    tex = f && game.texture(f.texture);
    return tex ? { ...tex } : null;
  }
  tex = game.texture(node.props.texture);
  if (!tex) return null;
  let { sx, sy, sw, sh } = tex;
  if (node.props.region_enabled) {
    const r = rect2(node.props.region_rect);
    [sx, sy, sw, sh] = [sx + r.x, sy + r.y, r.w, r.h];
  }
  const hf = node.props.hframes || 1, vf = node.props.vframes || 1;
  if (hf > 1 || vf > 1) {
    const fr = node.props.frame || 0;
    sw /= hf;
    sh /= vf;
    sx += (fr % hf) * sw;
    sy += Math.floor(fr / hf) * sh;
  }
  return { img: tex.img, sx, sy, sw, sh };
}

/** Rectangle a sprite covers in its own (local) coordinates. */
export function spriteRect(node, fr) {
  const off = vec2(node.props.offset);
  const centered = node.props.centered !== false;
  const w = fr.sw, h = fr.sh;
  return { x: off.x - (centered ? w / 2 : 0), y: off.y - (centered ? h / 2 : 0), w, h };
}

/**
 * Whether a node's pictures are drawn smoothed: its texture_filter, or its
 * parent's (TEXTURE_FILTER_PARENT_NODE), up to the project's default (`smoothing`).
 */
export function smoothFor(node, smoothing) {
  for (let n = node; n; n = n.parent) {
    const f = n.props && n.props.texture_filter;
    if (f) return f % 2 === 0; // LINEAR (2), LINEAR_WITH_MIPMAPS (4)...; NEAREST ones are odd
  }
  return smoothing;
}

// the clip rectangles of an item, in the canvas
function setClip(ctx, clip) {
  ctx.save();
  for (const c of clip) {
    ctx.setTransform(c.xf[0], c.xf[1], c.xf[2], c.xf[3], c.xf[4], c.xf[5]);
    ctx.beginPath();
    ctx.rect(0, 0, c.w, c.h);
    ctx.clip();
  }
}

const inClip = (clip, p) => !clip || clip.every((c) => {
  const l = apply(invert(c.xf), p);
  return l.x >= 0 && l.y >= 0 && l.x < c.w && l.y < c.h;
});

export function draw(ctx, game, items) {
  const smoothing = ctx.imageSmoothingEnabled;
  for (const it of items) {
    if (!it.clip) drawItem(ctx, game, it, smoothing);
    else {
      setClip(ctx, it.clip);
      drawItem(ctx, game, it, smoothing);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = smoothing;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawItem(ctx, game, it, smoothing) {
  drawOwn(ctx, game, it, smoothing);
  if (it.node.state.customDraw && customDraw) {
    let alpha = color(it.node.props.modulate).a * color(it.node.props.self_modulate).a;
    for (let n = it.node.parent; n; n = n.parent) alpha *= color(n.props.modulate).a;
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.setTransform(it.xf[0], it.xf[1], it.xf[2], it.xf[3], it.xf[4], it.xf[5]);
    customDraw(ctx, it.node, it.xf);
    ctx.restore();
  }
}

function drawOwn(ctx, game, { node, xf }, smoothing) {
  {
    if (!DRAWN_CONTROLS.has(node.type) && !DRAWN_NODES.has(node.type)) return;
    if (node.type === "Polygon2D" || node.type === "Line2D" || node.type === "GPUParticles2D") {
      const md = modulation(node);
      if (md.a <= 0) return;
      ctx.globalAlpha = md.a;
      ctx.setTransform(xf[0], xf[1], xf[2], xf[3], xf[4], xf[5]);
      if (node.type === "GPUParticles2D") drawParticles(ctx, game, node, md.a);
      else drawShape(ctx, node, md);
      return;
    }
    if (DRAWN_CONTROLS.has(node.type)) {
      const md = modulation(node);
      if (md.a <= 0) return;
      ctx.globalAlpha = md.a;
      ctx.setTransform(xf[0], xf[1], xf[2], xf[3], xf[4], xf[5]);
      if (md.r !== 1 || md.g !== 1 || md.b !== 1) drawTintedControl(ctx, game, node, xf, md);
      else drawControl(ctx, game, node);
      return;
    }
    const fr = spriteFrame(game, node);
    if (!fr) return;
    ctx.imageSmoothingEnabled = smoothFor(node, smoothing);
    const r = spriteRect(node, fr);
    const mod = color(node.props.modulate);
    const self = color(node.props.self_modulate);
    let alpha = mod.a * self.a;
    const tint = [mod.r * self.r, mod.g * self.g, mod.b * self.b];
    for (let n = node.parent; n; n = n.parent) {
      const c = color(n.props.modulate);
      alpha *= c.a;
      tint[0] *= c.r;
      tint[1] *= c.g;
      tint[2] *= c.b;
    }
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    let m = xf;
    const fx = node.props.flip_h ? -1 : 1, fy = node.props.flip_v ? -1 : 1;
    if (fx < 0 || fy < 0) {
      // flip around the sprite's own rectangle
      m = multiply(m, [fx, 0, 0, fy, fx < 0 ? 2 * r.x + r.w : 0, fy < 0 ? 2 * r.y + r.h : 0]);
    }
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    // a ShaderMaterial on a sprite whose frame is its whole picture: the shader draws it
    if (hasShader(node) && !fr.sx && !fr.sy && fr.sw === fr.img.width && fr.sh === fr.img.height) {
      ctx.translate(r.x, r.y);
      if (drawShaded(ctx, game, node, r.w, r.h, { picture: fr.img })) return;
      ctx.translate(-r.x, -r.y);
    }
    if (tint.some((v) => v !== 1)) {
      const t = tinted(fr, tint);
      if (t) return ctx.drawImage(t, 0, 0, fr.sw, fr.sh, r.x, r.y, r.w, r.h);
    }
    ctx.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, r.x, r.y, r.w, r.h);
  }
}

/** modulate * self_modulate of a node and its ancestors' modulate: {r, g, b, a}. */
export function modulation(node) {
  const m = color(node.props.modulate), sm = color(node.props.self_modulate);
  const out = { r: m.r * sm.r, g: m.g * sm.g, b: m.b * sm.b, a: m.a * sm.a };
  for (let n = node.parent; n; n = n.parent) {
    const c = color(n.props.modulate);
    out.r *= c.r;
    out.g *= c.g;
    out.b *= c.b;
    out.a *= c.a;
  }
  return out;
}

// a Control with modulate's RGB: drawn apart, multiplied by the color, then put on the canvas
let tintA = null, tintB = null;
function drawTintedControl(ctx, game, node, xf, md) {
  const r = controlRect(node);
  // its rectangle on the canvas (with some room for text overhang)
  const pts = [[0, 0], [r.w, 0], [0, r.h], [r.w, r.h]].map(([x, y]) => apply(xf, { x, y }));
  const pad = 8;
  const x0 = Math.floor(Math.min(...pts.map((p) => p.x)) - pad), y0 = Math.floor(Math.min(...pts.map((p) => p.y)) - pad);
  const w = Math.ceil(Math.max(...pts.map((p) => p.x)) + pad) - x0, h = Math.ceil(Math.max(...pts.map((p) => p.y)) + pad) - y0;
  if (w <= 0 || h <= 0) return;
  try {
    tintA ||= document.createElement("canvas");
    tintB ||= document.createElement("canvas");
  } catch {
    return drawControl(ctx, game, node);
  }
  for (const c of [tintA, tintB]) {
    if (c.width < w) c.width = w;
    if (c.height < h) c.height = h;
  }
  const a = tintA.getContext("2d"), b = tintB.getContext("2d");
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.globalCompositeOperation = "source-over";
  a.globalAlpha = 1;
  a.clearRect(0, 0, w, h);
  a.setTransform(xf[0], xf[1], xf[2], xf[3], xf[4] - x0, xf[5] - y0);
  drawControl(a, game, node);
  a.setTransform(1, 0, 0, 1, 0, 0);
  b.clearRect(0, 0, w, h);
  b.drawImage(tintA, 0, 0, w, h, 0, 0, w, h);
  a.globalCompositeOperation = "multiply";
  a.fillStyle = `rgb(${md.r * 255},${md.g * 255},${md.b * 255})`;
  a.fillRect(0, 0, w, h);
  a.globalCompositeOperation = "destination-in";
  a.drawImage(tintB, 0, 0, w, h, 0, 0, w, h);
  a.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(tintA, 0, 0, w, h, x0, y0, w, h);
  ctx.restore();
}

// a frame multiplied by a color (modulate's RGB), cached
const tints = new Map();
function tinted(fr, [r, g, b]) {
  const key = `${fr.img.src}|${fr.sx},${fr.sy},${fr.sw},${fr.sh}|${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)}`;
  if (tints.has(key)) return tints.get(key);
  if (tints.size > 256) tints.clear();
  let c = null;
  try {
    c = document.createElement("canvas");
    c.width = Math.max(1, fr.sw);
    c.height = Math.max(1, fr.sh);
    const cx = c.getContext("2d");
    cx.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, 0, 0, fr.sw, fr.sh);
    cx.globalCompositeOperation = "multiply";
    cx.fillStyle = `rgb(${Math.min(255, r * 255)},${Math.min(255, g * 255)},${Math.min(255, b * 255)})`;
    cx.fillRect(0, 0, fr.sw, fr.sh);
    cx.globalCompositeOperation = "destination-in";
    cx.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, 0, 0, fr.sw, fr.sh);
  } catch {
    c = null;
  }
  tints.set(key, c);
  return c;
}

// Polygon2D (a filled polygon) / Line2D (a polyline), in the node's coordinates
function drawShape(ctx, node, md = { r: 1, g: 1, b: 1 }) {
  const p = node.props;
  const pts = points(node.type === "Polygon2D" ? p.polygon : p.points);
  if (pts.length < 2) return;
  const o = node.type === "Polygon2D" ? vec2(p.offset) : { x: 0, y: 0 };
  ctx.beginPath();
  ctx.moveTo(pts[0].x + o.x, pts[0].y + o.y);
  for (const q of pts.slice(1)) ctx.lineTo(q.x + o.x, q.y + o.y);
  if (node.type === "Polygon2D") {
    if (pts.length < 3) return;
    ctx.closePath();
    const c = color(p.color);
    ctx.globalAlpha *= c.a;
    ctx.fillStyle = `rgb(${c.r * md.r * 255},${c.g * md.g * 255},${c.b * md.b * 255})`;
    ctx.fill();
    return;
  }
  if (p.closed) ctx.closePath();
  const c = color(p.default_color, [1, 1, 1, 1]);
  ctx.globalAlpha *= c.a;
  ctx.strokeStyle = `rgb(${c.r * md.r * 255},${c.g * md.g * 255},${c.b * md.b * 255})`;
  ctx.lineWidth = p.width ?? 10;
  ctx.lineJoin = ["miter", "bevel", "round"][p.joint_mode ?? 0] || "miter";
  ctx.lineCap = ["butt", "square", "round"][p.end_cap_mode ?? 0] || "butt";
  ctx.stroke();
}

/**
 * The Controls under point p (screen coordinates), topmost first, that catch
 * the mouse (mouse_filter not IGNORE): [{node, local}] with p in the
 * control's own coordinates.
 */
export function controlsAt(root, base, p) {
  const out = [];
  for (const it of collect(root, base, { allControls: true }).reverse()) {
    if (!CONTROL_TYPES.has(it.node.type) || mouseFilter(it.node) === 2) continue;
    const r = controlRect(it.node);
    const l = apply(invert(it.xf), p);
    if (l.x >= 0 && l.y >= 0 && l.x < r.w && l.y < r.h && inClip(it.clip, p)) out.push({ node: it.node, local: l, xf: it.xf });
  }
  return out;
}
