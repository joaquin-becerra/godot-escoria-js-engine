// Godot's canvas_item shaders (ShaderMaterial on a ColorRect, TextureRect or
// Sprite2D), run with WebGL2 and composited into the 2D canvas.
//
// The shader's code is Godot's shading language, which is GLSL ES 3.00 plus
// a few things this turns into plain GLSL:
//   - shader_type / render_mode lines (render_mode blend_mul / blend_add /
//     blend_sub / blend_premul_alpha become the canvas composite operation),
//   - uniform hints (`: hint_screen_texture, filter_nearest`) and initial
//     values (set from JS when the material doesn't give the parameter),
//   - the built-ins UV, COLOR, TEXTURE, SCREEN_UV, TIME, SCREEN_PIXEL_SIZE,
//     TEXTURE_PIXEL_SIZE, FRAGCOORD as globals that main() fills before
//     calling fragment(); vertex() / light() are dropped.
// A sampler with hint_screen_texture reads what is on the canvas so far.
// Parameters come from the material's props ("shader_parameter/<name>").
import { color as readColor } from "./values.js";

let gl = null, glCanvas = null;
const programs = new Map(); // shader code -> {program, uniforms, blend} | {error}
const textures = new WeakMap(); // image / canvas -> WebGL texture (pictures that don't change)

function context() {
  if (gl !== null) return gl;
  if (typeof document === "undefined") return (gl = false);
  glCanvas = document.createElement("canvas");
  gl = glCanvas.getContext("webgl2", { premultipliedAlpha: false, alpha: true, antialias: false }) || false;
  if (!gl) console.warn("shaders: this browser has no WebGL2; ShaderMaterials aren't drawn");
  return gl;
}

// ---------------------------------------------------------------- translation

const BLENDS = { blend_mul: "multiply", blend_add: "lighter", blend_sub: "difference", blend_mix: "source-over", blend_premul_alpha: "source-over" };

// removes a top-level function (void vertex() {...}) by matching its braces
function dropFunction(code, name) {
  const re = new RegExp(`void\\s+${name}\\s*\\(\\s*\\)\\s*\\{`);
  const m = re.exec(code);
  if (!m) return code;
  let i = m.index + m[0].length, depth = 1;
  while (i < code.length && depth) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
    i++;
  }
  return code.slice(0, m.index) + code.slice(i);
}

// a GLSL literal as a JS value: 1.0, true, vec2(1.0, 0.0)...
function literal(s) {
  s = s.trim();
  if (s === "true" || s === "false") return s === "true";
  const v = /^(?:vec[234]|ivec[234])\s*\(([^)]*)\)$/.exec(s);
  if (v) {
    const parts = v[1].split(",").map((x) => parseFloat(x));
    const n = Number(/\d/.exec(s)[0]);
    return parts.length === 1 ? Array(n).fill(parts[0]) : parts;
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/** Godot shader code -> {source (GLSL ES 3.00 fragment shader), uniforms [{name, type, hints, def}], blend} */
export function translateShader(code) {
  let src = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  let blend = "source-over";
  src = src.replace(/shader_type\s+\w+\s*;/, "");
  src = src.replace(/render_mode\s+([^;]+);/, (_, modes) => {
    for (const m of modes.split(",").map((x) => x.trim())) if (BLENDS[m]) blend = BLENDS[m];
    return "";
  });
  const uniforms = [];
  src = src.replace(/uniform\s+(\w+)\s+(\w+)\s*(?::\s*([^=;]+))?(?:=\s*([^;]+))?;/g, (_, type, name, hints, def) => {
    uniforms.push({ name, type, hints: (hints || "").split(",").map((h) => h.trim()).filter(Boolean), def: def ? literal(def) : null });
    return `uniform ${type} ${name};`;
  });
  // vertex(): only the quad growing by a margin (VERTEX += (UV * 2.0 - 1.0) * m,
  // maybe inside `if (flag)`), as outline shaders do; the rest is dropped
  let margin = null;
  const vx = /void\s+vertex\s*\(\s*\)\s*\{([\s\S]*?)\n\}/.exec(src);
  if (vx) {
    const m = /(?:if\s*\(\s*(\w+)\s*\)\s*\{?\s*)?VERTEX\s*\+=\s*\(\s*UV\s*\*\s*2\.0\s*-\s*1\.0\s*\)\s*\*\s*(\w+(?:\.\d+)?)/.exec(vx[1]);
    if (m) margin = { flag: m[1] || null, value: m[2] };
  }
  src = dropFunction(dropFunction(src, "vertex"), "light");
  // what Godot accepts and GLSL ES doesn't: a variable named `texture` (it hides
  // the function), pow() with an integer exponent
  src = src.replace(/\btexture\b(?!\s*\()/g, "godot_texture_var");
  src = src.replace(/\bpow\s*\(((?:[^(),]|\([^()]*\))+),\s*(-?\d+)\s*\)/g, "pow($1, $2.0)");
  const source = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 godot_out;
uniform vec4 godot_rect;      // the node on the canvas (pixels): x, y, w, h
uniform vec2 godot_view;      // canvas size
uniform vec4 godot_color;     // the node's color / modulate
uniform bool godot_has_texture;
uniform sampler2D TEXTURE;
uniform vec2 TEXTURE_PIXEL_SIZE;
uniform float TIME;
vec2 UV;
vec4 COLOR;
vec2 SCREEN_UV;
vec2 SCREEN_PIXEL_SIZE;
vec4 FRAGCOORD;
${src}
void main() {
  UV = v_uv;
  SCREEN_UV = (godot_rect.xy + v_uv * godot_rect.zw) / godot_view;
  SCREEN_PIXEL_SIZE = 1.0 / godot_view;
  FRAGCOORD = vec4(godot_rect.xy + v_uv * godot_rect.zw, 0.0, 1.0);
  COLOR = godot_has_texture ? texture(TEXTURE, UV) * godot_color : godot_color;
  ${/void\s+fragment\s*\(/.test(src) ? "fragment();" : ""}
  godot_out = COLOR;
}`;
  return { source, uniforms, blend, margin };
}

const VERTEX = `#version 300 es
in vec2 pos;
out vec2 v_uv;
void main() {
  // pos 0..1; the top of the picture is UV.y = 0 (Godot), at the top of the canvas
  v_uv = pos;
  gl_Position = vec4(pos.x * 2.0 - 1.0, 1.0 - pos.y * 2.0, 0.0, 1.0);
}`;

function compile(code) {
  if (programs.has(code)) return programs.get(code);
  const t = translateShader(code);
  const sh = (type, s) => {
    const x = gl.createShader(type);
    gl.shaderSource(x, s);
    gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x));
    return x;
  };
  let entry;
  try {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, t.source));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    entry = { program: p, buf, uniforms: t.uniforms, margin: t.margin, blend: t.blend, loc: (n) => gl.getUniformLocation(p, n) };
  } catch (e) {
    console.warn("shaders: no compila:", e.message, "\n" + t.source);
    entry = { error: e.message };
  }
  programs.set(code, entry);
  return entry;
}

// ---------------------------------------------------------------- drawing

function texture(source, unit, { changes = false, nearest = false } = {}) {
  let tex = !changes && textures.get(source);
  gl.activeTexture(gl.TEXTURE0 + unit);
  if (!tex) {
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (changes) (texture.temp ||= []).push(tex);
    else textures.set(source, tex);
  } else gl.bindTexture(gl.TEXTURE_2D, tex);
  const f = nearest ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  return tex;
}

// the picture of a texture value in the material: a res:// texture, or an ImageTexture made by a script
function pictureOf(game, v) {
  if (!v || typeof v !== "object") return null;
  if (v.__source) return v.__source;
  if (v.$res) {
    const t = game.texture(v.$res);
    return t ? t.img : null;
  }
  return null;
}

/**
 * Draws a node with a ShaderMaterial (its rectangle w x h in its own
 * coordinates, already transformed on ctx). Returns false if it can't (no
 * WebGL2, the shader doesn't compile): the node is then drawn as usual.
 */
export function drawShaded(ctx, game, node, w, h, { picture = null } = {}) {
  const mat = node.props.material;
  const code = mat && mat.props && mat.props.shader && mat.props.shader.props && mat.props.shader.props.code;
  if (!code || !context()) return false;
  const prog = compile(code);
  if (prog.error) return false;
  // where it lands on the canvas, in pixels (grown by the vertex() margin, if any)
  const m = ctx.getTransform();
  const param = (name) => {
    const v = mat.props[`shader_parameter/${name}`];
    if (v !== undefined && v !== null) return v;
    const u = prog.uniforms.find((x) => x.name === name);
    return u ? u.def : isNaN(+name) ? null : +name;
  };
  const mg = prog.margin && (!prog.margin.flag || param(prog.margin.flag)) ? Number(param(prog.margin.value)) || 0 : 0;
  const x0 = m.e - mg * Math.abs(m.a), y0 = m.f - mg * Math.abs(m.d);
  const pw = Math.max(1, Math.round(Math.abs((w + 2 * mg) * m.a))), ph = Math.max(1, Math.round(Math.abs((h + 2 * mg) * m.d)));
  if (glCanvas.width !== pw || glCanvas.height !== ph) {
    glCanvas.width = pw;
    glCanvas.height = ph;
  }
  gl.viewport(0, 0, pw, ph);
  gl.useProgram(prog.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, prog.buf);
  const posLoc = gl.getAttribLocation(prog.program, "pos");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  const c = readColor(node.props.color || null);
  const mod = readColor(node.props.modulate || null);
  const col = node.type === "ColorRect" ? [c.r, c.g, c.b, c.a] : [mod.r, mod.g, mod.b, mod.a];
  gl.uniform4f(prog.loc("godot_rect"), x0, y0, pw, ph);
  gl.uniform2f(prog.loc("godot_view"), ctx.canvas.width, ctx.canvas.height);
  gl.uniform4f(prog.loc("godot_color"), ...col);
  gl.uniform1f(prog.loc("TIME"), performance.now() / 1000);
  let unit = 0;
  gl.uniform1i(prog.loc("godot_has_texture"), picture ? 1 : 0);
  if (picture) {
    texture(picture, unit);
    gl.uniform1i(prog.loc("TEXTURE"), unit);
    gl.uniform2f(prog.loc("TEXTURE_PIXEL_SIZE"), 1 / (picture.width || 1), 1 / (picture.height || 1));
  }
  unit++;
  for (const u of prog.uniforms) {
    const loc = prog.loc(u.name);
    if (!loc) continue;
    let v = mat.props[`shader_parameter/${u.name}`];
    if (u.type === "sampler2D") {
      const nearest = u.hints.includes("filter_nearest");
      let src = null;
      if (u.hints.includes("hint_screen_texture")) src = ctx.canvas;
      else src = pictureOf(game, v);
      if (!src) {
        // an empty texture: a white pixel (Godot's default for a missing sampler)
        src = (drawShaded.white ||= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }));
        const wc = src.getContext("2d");
        wc.fillStyle = "#fff";
        wc.fillRect(0, 0, 1, 1);
      }
      texture(src, unit, { changes: src === ctx.canvas, nearest });
      gl.uniform1i(loc, unit++);
      continue;
    }
    if (v === undefined || v === null) v = u.def;
    if (v === null || v === undefined) continue;
    const arr = v && v.args ? v.args : Array.isArray(v) ? v : null;
    switch (u.type) {
      case "float": gl.uniform1f(loc, Number(v)); break;
      case "int": gl.uniform1i(loc, Math.trunc(v)); break;
      case "bool": gl.uniform1i(loc, v ? 1 : 0); break;
      case "vec2": gl.uniform2f(loc, ...(arr || [0, 0]).slice(0, 2)); break;
      case "vec3": gl.uniform3f(loc, ...(arr || [0, 0, 0]).slice(0, 3)); break;
      case "vec4": gl.uniform4f(loc, ...(arr || [0, 0, 0, 1]).slice(0, 4)); break;
    }
  }
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  for (const t of texture.temp || []) gl.deleteTexture(t);
  texture.temp = [];
  // onto the canvas, in the material's blend mode
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = prog.blend;
  ctx.drawImage(glCanvas, x0, y0, pw, ph);
  ctx.restore();
  return true;
}

/** Does the node have a ShaderMaterial with code? */
export const hasShader = (node) => {
  const m = node.props.material;
  return !!(m && m.props && m.props.shader && m.props.shader.props && m.props.shader.props.code);
};
