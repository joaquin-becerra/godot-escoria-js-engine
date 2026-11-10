// Control nodes in a canvas item tree: layout (anchors and offsets, and the
// arrangement of containers: Grid, HBox, VBox, Margin, Center, Panel) and
// drawing (Label, Panel, ColorRect, TextureRect, Button, LineEdit, TextEdit)
// with Godot's default theme where the scene doesn't override it.
// The UI state the drawing needs (hovered, focused, held control) is in `ui`.
import { color, cssColor } from "./values.js";
import { drawShaded, hasShader } from "./shaders.js";

export const CONTROL_TYPES = new Set([
  "Control", "Label", "RichTextLabel", "Panel", "PanelContainer", "ColorRect", "TextureRect", "Button", "TextureButton", "CheckBox",
  "LineEdit", "TextEdit", "OptionButton", "HSlider", "VSlider", "VBoxContainer", "HBoxContainer", "GridContainer", "MarginContainer", "ScrollContainer", "CenterContainer",
]);
export const DRAWN_CONTROLS = new Set(["Label", "Panel", "PanelContainer", "ColorRect", "TextureRect", "Button", "CheckBox", "LineEdit", "TextEdit", "OptionButton", "HSlider", "VSlider", "ScrollContainer"]);
const CONTAINERS = new Set(["VBoxContainer", "HBoxContainer", "GridContainer", "MarginContainer", "CenterContainer", "PanelContainer", "ScrollContainer"]);

/** UI state for drawing: the control under the mouse, the focused one, the one held down. */
export const ui = { hover: null, focus: null, down: null, caret: true, drag: null, popup: null };

let GAME = null;
let VIEWPORT = { w: 1152, h: 648 };
/** The game (fonts, translations) and the viewport size Controls without a Control parent anchor to. */
export function setGame(game) {
  GAME = game;
  VIEWPORT = { w: game.setting("display/window/size/viewport_width", 1152), h: game.setting("display/window/size/viewport_height", 648) };
}

// ---------------------------------------------------------------- default theme (Godot 4, approximately)

const THEME = {
  fontSize: 16,
  fontColor: "rgba(224, 224, 224, 1)", fontHover: "rgba(242, 242, 242, 1)", fontPressed: "rgba(255, 255, 255, 1)", fontDisabled: "rgba(224, 224, 224, 0.5)",
  normal: "rgba(26, 26, 26, 0.6)", hover: "rgba(57, 57, 57, 0.6)", pressed: "rgba(0, 0, 0, 0.6)", disabled: "rgba(26, 26, 26, 0.3)",
  panel: "rgba(26, 26, 26, 0.6)", edit: "rgba(26, 26, 26, 0.6)", focusBorder: "rgba(255, 255, 255, 0.75)",
  pad: 8, separation: 4,
};

// ---------------------------------------------------------------- text

let measureCtx = null;
/** The font for a control's text: {font, size, ...} from its override, or null (the browser's at the theme size). */
function fontFor(node) {
  const p = node.props;
  const res = (p["theme_override_fonts/font"] || p["theme_override_fonts/normal_font"])?.$res;
  const size = p["theme_override_font_sizes/font_size"] || p["theme_override_font_sizes/normal_font_size"];
  const f = res && GAME ? GAME.resolveFont(res, size) : null;
  if (!f) return f;
  // outline and line spacing from the control's overrides
  const o = p["theme_override_constants/outline_size"], ls = p["theme_override_constants/line_separation"] ?? p["theme_override_constants/line_spacing"];
  if (!o && ls === undefined) return f;
  return { ...f, ...(o ? { outline: o, outlineColor: cssColor(p["theme_override_colors/font_outline_color"] || { type: "Color", args: [0, 0, 0, 1] }) } : {}), ...(ls !== undefined ? { lineSep: ls } : {}) };
}
function measure(node, text) {
  const f = fontFor(node);
  const size = node.props["theme_override_font_sizes/font_size"] || THEME.fontSize;
  if (f && f.font) return { w: f.font.measure(text, f.size), h: f.font.lineHeightAt(f.size) };
  if (!measureCtx && typeof document !== "undefined") measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return { w: text.length * size * 0.55, h: size * 1.3 };
  measureCtx.font = `${size}px system-ui, sans-serif`;
  return { w: measureCtx.measureText(text).width, h: size * 1.3 };
}
/** Does a control translate its text? auto_translate_mode: 0 inherit, 1 always, 2 disabled. */
export function translates(node) {
  for (let n = node; n; n = n.parent) {
    const m = n.props && n.props.auto_translate_mode;
    if (m === 2 || (n.props && n.props.auto_translate === false)) return false;
    if (m === 1) return true;
  }
  return true;
}
const trOf = (node, s) => (GAME && translates(node) ? GAME.tr(s) : s);
const textOf = (node) => trOf(node, String(node.props.text ?? ""));

// ---------------------------------------------------------------- layout

const visible = (n) => n.props.visible !== false;
const isControl = (n) => CONTROL_TYPES.has(n.type);
const flagsH = (n) => n.props.size_flags_horizontal ?? 1;
const flagsV = (n) => n.props.size_flags_vertical ?? 1;
const constant = (n, k, def) => n.props[`theme_override_constants/${k}`] ?? def;

/** Smallest size a control asks for (custom_minimum_size, its text, its children). */
// words of a text in lines no wider than w
function wrapWords(n, text, w) {
  const out = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? line + " " + word : word;
      if (line && measure(n, next).w > w) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/**
 * Smallest size a control asks for. `width`: the width it will get, for what
 * depends on it (an autowrap Label's height).
 */
export function minSize(n, width = 0) {
  const cms = n.props.custom_minimum_size;
  let w = cms && cms.args ? cms.args[0] : 0, h = cms && cms.args ? cms.args[1] : 0;
  let cw = 0, ch = 0;
  switch (n.type) {
    case "Button": case "CheckBox": {
      const m = measure(n, textOf(n));
      [cw, ch] = [m.w + THEME.pad * 2, m.h + THEME.pad];
      break;
    }
    case "OptionButton": {
      const items = optionItems(n);
      const m = items.map((it) => measure(n, trOf(n, it.text)));
      [cw, ch] = [Math.max(0, ...m.map((x) => x.w)) + THEME.pad * 2 + ARROW, (m[0] || measure(n, "Hg")).h + THEME.pad];
      break;
    }
    case "HSlider": [cw, ch] = [0, 16]; break;
    case "VSlider": [cw, ch] = [16, 0]; break;
    case "Label": {
      if (n.props.clip_text) break;
      if (n.props.autowrap_mode) {
        // as wide as it gets; as tall as its text wrapped to that
        if (width > 0) ch = wrapWords(n, textOf(n), width).length * measure(n, "Hg").h;
        break;
      }
      const lines = textOf(n).split("\n");
      const ms = lines.map((l) => measure(n, l));
      [cw, ch] = [Math.max(0, ...ms.map((m) => m.w)), ms.reduce((a, m) => a + m.h, 0)];
      break;
    }
    case "LineEdit": [cw, ch] = [60, measure(n, "Hg").h + 8]; break;
    case "TextureRect": {
      // EXPAND_KEEP_SIZE (0): the texture's size
      const tex = !n.props.expand_mode && n.props.texture && GAME && GAME.texture(n.props.texture.$res);
      if (tex) [cw, ch] = [tex.img.width, tex.img.height];
      break;
    }
    case "HBoxContainer": case "VBoxContainer": {
      const kids = n.children.filter((c) => isControl(c) && visible(c));
      const sep = constant(n, "separation", THEME.separation);
      const horiz = n.type === "HBoxContainer";
      // a VBox's children get its width (its own, if it has one)
      const own = (n.props.offset_right ?? 0) - (n.props.offset_left ?? 0);
      const sizes = kids.map((c) => minSize(c, horiz ? 0 : width || (own > 0 ? own : 0)));
      const along = sizes.reduce((a, s) => a + (horiz ? s.w : s.h), 0) + Math.max(0, kids.length - 1) * sep;
      const across = Math.max(0, ...sizes.map((s) => (horiz ? s.h : s.w)));
      [cw, ch] = horiz ? [along, across] : [across, along];
      break;
    }
    case "GridContainer": {
      const g = gridMetrics(n);
      [cw, ch] = [g.colMin.reduce((a, x) => a + x, 0) + g.hs * Math.max(0, g.cols - 1), g.rowMin.reduce((a, x) => a + x, 0) + g.vs * Math.max(0, g.rows - 1)];
      break;
    }
    case "ScrollContainer": break; // it scrolls what doesn't fit
    case "MarginContainer": case "PanelContainer": case "CenterContainer": {
      const m = margins(n);
      for (const c of n.children.filter((c) => isControl(c) && visible(c))) {
        const s = minSize(c);
        cw = Math.max(cw, s.w);
        ch = Math.max(ch, s.h);
      }
      cw += m.l + m.r;
      ch += m.t + m.b;
      break;
    }
  }
  return { w: Math.max(w, cw), h: Math.max(h, ch) };
}

function margins(n) {
  if (n.type === "MarginContainer") return { l: constant(n, "margin_left", 0), t: constant(n, "margin_top", 0), r: constant(n, "margin_right", 0), b: constant(n, "margin_bottom", 0) };
  const sb = n.type === "PanelContainer" && n.props["theme_override_styles/panel"];
  const p = (sb && sb.props) || {};
  return { l: p.content_margin_left || 0, t: p.content_margin_top || 0, r: p.content_margin_right || 0, b: p.content_margin_bottom || 0 };
}

function gridMetrics(n) {
  const cols = Math.max(1, n.props.columns || 1);
  const kids = n.children.filter((c) => isControl(c) && visible(c));
  const rows = Math.ceil(kids.length / cols);
  const hs = constant(n, "h_separation", THEME.separation), vs = constant(n, "v_separation", THEME.separation);
  const colMin = Array(cols).fill(0), rowMin = Array(rows).fill(0);
  const colExp = Array(cols).fill(false), rowExp = Array(rows).fill(false);
  kids.forEach((c, i) => {
    const s = minSize(c), col = i % cols, row = Math.floor(i / cols);
    colMin[col] = Math.max(colMin[col], s.w);
    rowMin[row] = Math.max(rowMin[row], s.h);
    if (flagsH(c) & 2) colExp[col] = true;
    if (flagsV(c) & 2) rowExp[row] = true;
  });
  return { cols, rows, kids, hs, vs, colMin, rowMin, colExp, rowExp };
}

// spread `total` among sizes: the expanding ones share what is left, equally
function distribute(mins, expand, total, sep) {
  const free = total - mins.reduce((a, x) => a + x, 0) - sep * Math.max(0, mins.length - 1);
  const n = expand.filter(Boolean).length;
  if (n && free > 0) {
    // like Godot: expanding items get equal sizes (at least their minimum)
    const expTotal = mins.reduce((a, x, i) => a + (expand[i] ? x : 0), 0) + free;
    const each = expTotal / n;
    return mins.map((m, i) => (expand[i] ? Math.max(m, each) : m));
  }
  return mins.slice();
}

/** Rectangles of a container's children, relative to the container: Map(child -> {x, y, w, h}). */
function arrange(n) {
  const r = controlRect(n);
  const out = new Map();
  const kids = n.children.filter((c) => isControl(c) && visible(c));
  const place = (c, x, y, w, h) => {
    // a child that doesn't fill its cell gets its minimum size, centered (SIZE_SHRINK_CENTER) or at the start
    const s = minSize(c);
    let cw = w, ch = h, cx = x, cy = y;
    if (!(flagsH(c) & 1)) {
      cw = s.w;
      if (flagsH(c) & 4) cx = x + (w - s.w) / 2;
      else if (flagsH(c) & 8) cx = x + w - s.w;
    }
    if (!(flagsV(c) & 1)) {
      ch = s.h;
      if (flagsV(c) & 4) cy = y + (h - s.h) / 2;
      else if (flagsV(c) & 8) cy = y + h - s.h;
    }
    out.set(c, { x: cx, y: cy, w: cw, h: ch });
  };
  if (n.type === "HBoxContainer" || n.type === "VBoxContainer") {
    const horiz = n.type === "HBoxContainer";
    const sep = constant(n, "separation", THEME.separation);
    const mins = kids.map((c) => (horiz ? minSize(c).w : minSize(c, r.w).h));
    const exp = kids.map((c) => !!((horiz ? flagsH(c) : flagsV(c)) & 2));
    const total = horiz ? r.w : r.h;
    const sizes = distribute(mins, exp, total, sep);
    const used = sizes.reduce((a, x) => a + x, 0) + sep * Math.max(0, kids.length - 1);
    const align = n.props.alignment || 0; // 0 begin, 1 center, 2 end
    let pos = exp.some(Boolean) ? 0 : align === 1 ? (total - used) / 2 : align === 2 ? total - used : 0;
    kids.forEach((c, i) => {
      if (horiz) place(c, pos, 0, sizes[i], r.h);
      else place(c, 0, pos, r.w, sizes[i]);
      pos += sizes[i] + sep;
    });
  } else if (n.type === "GridContainer") {
    const g = gridMetrics(n);
    const cw = distribute(g.colMin, g.colExp, r.w, g.hs), rh = distribute(g.rowMin, g.rowExp, r.h, g.vs);
    g.kids.forEach((c, i) => {
      const col = i % g.cols, row = Math.floor(i / g.cols);
      const x = cw.slice(0, col).reduce((a, v) => a + v + g.hs, 0), y = rh.slice(0, row).reduce((a, v) => a + v + g.vs, 0);
      place(c, x, y, cw[col], rh[row]);
    });
  } else if (n.type === "ScrollContainer") {
    // the child gets at least the container's size, moved by the scroll
    const sc = scrollInfo(n);
    for (const c of kids) {
      const s = minSize(c);
      const w = sc.horizontal ? Math.max(sc.w, s.w) : sc.w, h = sc.vertical ? Math.max(sc.h, s.h) : sc.h;
      out.set(c, { x: -(n.props.scroll_horizontal || 0), y: -(n.props.scroll_vertical || 0), w, h });
    }
  } else {
    // Margin / Panel / Center: every child fills the area inside the margins
    const m = margins(n);
    for (const c of kids) {
      if (n.type === "CenterContainer") {
        const s = minSize(c);
        out.set(c, { x: (r.w - s.w) / 2, y: (r.h - s.h) / 2, w: s.w, h: s.h });
      } else place(c, m.l, m.t, r.w - m.l - m.r, r.h - m.t - m.b);
    }
  }
  return out;
}

// parents that aren't CanvasItems: a Control under them anchors to the viewport
const NON_CANVAS = new Set(["Node", "CanvasLayer", "Viewport", "SubViewport", "Window", "Timer", "AnimationPlayer", "AudioStreamPlayer"]);

/**
 * Size of a Control's parent area: the parent Control; the viewport when the
 * parent isn't a CanvasItem; 0x0 under a Node2D (Godot 4's
 * CanvasItem.get_anchorable_rect is empty for non-Controls).
 */
function parentSize(node) {
  const p = node.parent;
  if (!p || NON_CANVAS.has(p.type)) return VIEWPORT;
  if (!CONTROL_TYPES.has(p.type)) return { w: 0, h: 0 };
  const r = controlRect(p);
  return { w: r.w, h: r.h };
}

/** A Control's rectangle relative to its parent: {x, y, w, h}. */
export function controlRect(node) {
  const p = node.parent;
  if (p && CONTAINERS.has(p.type) && visible(node)) {
    const r = arrange(p).get(node);
    if (r) return r;
  }
  const ps = parentSize(node);
  const a = (k) => node.props[k] ?? 0;
  const l = a("anchor_left") * ps.w + a("offset_left");
  const t = a("anchor_top") * ps.h + a("offset_top");
  const r = a("anchor_right") * ps.w + a("offset_right");
  const b = a("anchor_bottom") * ps.h + a("offset_bottom");
  // a control is never smaller than its minimum size (Labels keep their
  // rectangle: their text is measured with the label's own settings when drawn)
  const m = node.type === "Label" ? { w: 0, h: 0 } : minSize(node);
  return { x: l, y: t, w: Math.max(r - l, m.w), h: Math.max(b - t, m.h) };
}

// ---------------------------------------------------------------- scroll, ranges, options

const SCROLLBAR = 10, ARROW = 20;

/**
 * A ScrollContainer: its size, the content's size, how far each way it can
 * scroll ({w, h, cw, ch, maxX, maxY, vertical, horizontal}). Scroll modes:
 * 0 disabled, 1 auto, 2 always show, 3 never show (but scrolls).
 */
export function scrollInfo(n) {
  const p = n.props;
  const r = controlRect(n);
  const child = n.children.find((c) => isControl(c) && visible(c));
  const s = child ? minSize(child) : { w: 0, h: 0 };
  const vertical = (p.vertical_scroll_mode ?? 1) !== 0, horizontal = (p.horizontal_scroll_mode ?? 1) !== 0;
  return { w: r.w, h: r.h, cw: s.w, ch: s.h, vertical, horizontal, maxX: horizontal ? Math.max(0, s.w - r.w) : 0, maxY: vertical ? Math.max(0, s.h - r.h) : 0 };
}

/** Scrolls a ScrollContainer by (dx, dy), within its limits. True if it moved. */
export function scrollBy(n, dx, dy) {
  const sc = scrollInfo(n);
  const p = n.props;
  const x = Math.min(sc.maxX, Math.max(0, (p.scroll_horizontal || 0) + dx));
  const y = Math.min(sc.maxY, Math.max(0, (p.scroll_vertical || 0) + dy));
  if (x === (p.scroll_horizontal || 0) && y === (p.scroll_vertical || 0)) return false;
  p.scroll_horizontal = Math.round(x);
  p.scroll_vertical = Math.round(y);
  return true;
}

/** Range (HSlider, VSlider): its value set within min / max and rounded to the step. */
export function setRangeValue(n, v) {
  const p = n.props;
  const min = p.min_value ?? 0, max = p.max_value ?? 100, step = p.step ?? 1;
  if (step > 0) v = min + Math.round((v - min) / step) * step;
  v = Math.min(max, Math.max(min, v));
  if (p.rounded) v = Math.round(v);
  if (v === (p.value ?? 0)) return false;
  p.value = v;
  return true;
}

/** The value a point on a slider means (l: the point in the slider's coordinates). */
export function sliderValueAt(n, l) {
  const r = controlRect(n);
  const p = n.props;
  const min = p.min_value ?? 0, max = p.max_value ?? 100;
  const k = n.type === "VSlider" ? 1 - (l.y - GRABBER / 2) / Math.max(1, r.h - GRABBER) : (l.x - GRABBER / 2) / Math.max(1, r.w - GRABBER);
  return min + Math.min(1, Math.max(0, k)) * (max - min);
}
const GRABBER = 16;

/** An OptionButton's items: [{text, id, disabled}] (from the scene's popup/item_N, or set by scripts). */
export function optionItems(n) {
  if (n.state.items) return n.state.items;
  const p = n.props, items = [];
  for (let i = 0; i < (p.item_count || 0); i++) {
    items.push({ text: String(p[`popup/item_${i}/text`] ?? ""), id: p[`popup/item_${i}/id`] ?? i, disabled: !!p[`popup/item_${i}/disabled`] });
  }
  return (n.state.items = items);
}

/**
 * The open list of an OptionButton (ui.popup = {node, x, y, w, h, itemH, hover}),
 * in screen coordinates; drawn above everything by drawPopup().
 */
// the list's own node (PopupMenu): theme overrides and min_size set by scripts (get_popup())
const popupOf = (n) => n.state.popup || null;

export function openPopup(n, xf) {
  const r = controlRect(n);
  const items = optionItems(n);
  const pn = popupOf(n);
  const textNode = pn && (pn.props["theme_override_fonts/font"] || pn.props["theme_override_font_sizes/font_size"]) ? pn : n;
  const sb = pn && pn.props["theme_override_styles/panel"];
  const pad = sb && sb.props ? { t: sb.props.content_margin_top ?? 4, b: sb.props.content_margin_bottom ?? 4 } : { t: 0, b: 0 };
  const itemH = Math.max(pn ? 0 : r.h, measure(textNode, "Hg").h + THEME.pad);
  const x = xf[4], y0 = xf[5] + r.h * xf[3];
  const h = items.length * itemH + pad.t + pad.b;
  // above the button if it doesn't fit below
  const y = y0 + h > VIEWPORT.h && xf[5] - h >= 0 ? xf[5] - h : y0;
  const minW = pn && pn.state.minSize ? pn.state.minSize.x : 0;
  ui.popup = { node: n, x, y, w: Math.max(r.w * xf[0], minW), h, itemH, hover: -1, pad, textNode };
}

/** Which item of the open popup is at p (-1 none, null outside the popup). */
export function popupItemAt(p) {
  const pp = ui.popup;
  if (!pp || !p || p.x < pp.x || p.x >= pp.x + pp.w || p.y < pp.y || p.y >= pp.y + pp.h) return null;
  const i = Math.floor((p.y - pp.y - (pp.pad ? pp.pad.t : 0)) / pp.itemH);
  return i >= 0 && i < optionItems(pp.node).length ? i : -1;
}

export function drawPopup(ctx) {
  const pp = ui.popup;
  if (!pp) return;
  const n = pp.node;
  const items = optionItems(n);
  const pn = popupOf(n);
  const pp_ = (k) => pn && pn.props[k];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (pp_("theme_override_styles/panel")) drawStyleBox(ctx, GAME, pp_("theme_override_styles/panel"), pp.x, pp.y, pp.w, pp.h);
  else {
    ctx.fillStyle = "rgba(33, 33, 33, 0.97)";
    ctx.fillRect(pp.x, pp.y, pp.w, pp.h);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(pp.x + 0.5, pp.y + 0.5, pp.w - 1, pp.h - 1);
  }
  const color = (k, def) => (pp_(`theme_override_colors/${k}`) ? cssColor(pp_(`theme_override_colors/${k}`)) : def);
  const tr = pn ? translates(pn) && translates(n) : translates(n);
  const top = pp.pad ? pp.pad.t : 0;
  items.forEach((it, i) => {
    const y = pp.y + top + i * pp.itemH;
    const hover = i === pp.hover && !it.disabled;
    if (hover) {
      if (pp_("theme_override_styles/hover")) drawStyleBox(ctx, GAME, pp_("theme_override_styles/hover"), pp.x, y, pp.w, pp.itemH);
      else {
        ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
        ctx.fillRect(pp.x + 1, y, pp.w - 2, pp.itemH);
      }
    }
    ctx.save();
    ctx.translate(pp.x, y);
    const sel = i === (n.props.selected ?? -1);
    const text = tr && GAME ? GAME.tr(it.text) : it.text;
    const col = it.disabled ? THEME.fontDisabled : hover ? color("font_hover_color", THEME.fontColor) : color("font_color", THEME.fontColor);
    drawText(ctx, pp.textNode || n, (sel ? "✓ " : "   ") + text, { x: 0, y: 0, w: pp.w, h: pp.itemH }, col, 0, 1, THEME.pad);
    ctx.restore();
  });
}

// mouse_filter: STOP (0) catches clicks, PASS (1) / IGNORE (2) let them through
const DEFAULT_FILTER = { OptionButton: 0, HSlider: 0, VSlider: 0, Label: 2, Control: 0, Panel: 0, PanelContainer: 0, ColorRect: 0, TextureRect: 0, Button: 0, CheckBox: 0, TextureButton: 0, LineEdit: 0, TextEdit: 0, VBoxContainer: 1, HBoxContainer: 1, GridContainer: 1, MarginContainer: 1, CenterContainer: 1, ScrollContainer: 0 };
export function mouseFilter(n) {
  return n.props.mouse_filter ?? DEFAULT_FILTER[n.type] ?? 0;
}
export const INTERACTIVE = new Set(["Button", "CheckBox", "TextureButton", "LineEdit", "TextEdit", "OptionButton", "HSlider", "VSlider", "ScrollContainer"]);

/** StyleBoxFlat: background and borders. */
export function drawStyleBox(ctx, game, sb, x, y, w, h) {
  if (!sb || !sb.props) return;
  const p = sb.props;
  if (sb.type === "StyleBoxFlat") {
    const bl = p.border_width_left || 0, bt = p.border_width_top || 0, br = p.border_width_right || 0, bb = p.border_width_bottom || 0;
    if (p.draw_center !== false) {
      ctx.fillStyle = cssColor(p.bg_color || { type: "Color", args: [0.6, 0.6, 0.6, 1] });
      ctx.fillRect(x, y, w, h);
    }
    if (bl || bt || br || bb) {
      ctx.fillStyle = cssColor(p.border_color || { type: "Color", args: [0.8, 0.8, 0.8, 1] });
      ctx.fillRect(x, y, w, bt);
      ctx.fillRect(x, y + h - bb, w, bb);
      ctx.fillRect(x, y, bl, h);
      ctx.fillRect(x + w - br, y, br, h);
    }
  } else if (sb.type === "StyleBoxTexture") {
    const tex = p.texture && game.texture(p.texture.$res);
    if (!tex) return;
    // nine-patch with texture_margin_*
    const img = tex.img;
    const ml = p.texture_margin_left || 0, mt = p.texture_margin_top || 0, mr = p.texture_margin_right || 0, mb = p.texture_margin_bottom || 0;
    const iw = img.width, ih = img.height;
    const sx = [0, ml, iw - mr, iw], sy = [0, mt, ih - mb, ih];
    const dx = [x, x + ml, x + w - mr, x + w], dy = [y, y + mt, y + h - mb, y + h];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const sw = sx[i + 1] - sx[i], sh = sy[j + 1] - sy[j], dw = dx[i + 1] - dx[i], dh = dy[j + 1] - dy[j];
        if (sw > 0 && sh > 0 && dw > 0 && dh > 0) ctx.drawImage(img, sx[i], sy[j], sw, sh, dx[i], dy[j], dw, dh);
      }
  }
}

/** Draws a Control whose local rectangle starts at the current transform's origin. */
export function drawControl(ctx, game, node) {
  const r = controlRect(node);
  const p = node.props;
  // a ShaderMaterial (ColorRect, TextureRect): the shader draws it (if it
  // can't run, nothing: a plain white rectangle would cover what it shades)
  if (hasShader(node) && (node.type === "ColorRect" || node.type === "TextureRect")) {
    const tex = node.type === "TextureRect" && p.texture && game.texture(p.texture.$res);
    drawShaded(ctx, game, node, r.w, r.h, { picture: tex ? tex.img : null });
    return;
  }
  switch (node.type) {
    case "ColorRect":
      ctx.fillStyle = cssColor(p.color || { type: "Color", args: [1, 1, 1, 1] });
      ctx.fillRect(0, 0, r.w, r.h);
      break;
    case "Panel":
    case "PanelContainer":
      drawStyleBox(ctx, game, p["theme_override_styles/panel"], 0, 0, r.w, r.h);
      break;
    case "TextureRect": {
      const tex = p.texture && game.texture(p.texture.$res);
      if (!tex) break;
      const w = r.w || tex.img.width, h = r.h || tex.img.height;
      ctx.drawImage(tex.img, 0, 0, w, h);
      break;
    }
    case "Label":
      drawLabel(ctx, game, node, r);
      break;
    case "Button":
    case "CheckBox":
      drawButton(ctx, game, node, r);
      break;
    case "LineEdit":
    case "TextEdit":
      drawEdit(ctx, game, node, r);
      break;
    case "OptionButton":
      drawOption(ctx, game, node, r);
      break;
    case "HSlider":
    case "VSlider":
      drawSlider(ctx, game, node, r);
      break;
    case "ScrollContainer":
      drawScrollbars(ctx, node, r);
      break;
  }
}

function drawOption(ctx, game, node, r) {
  // a Button showing the selected item, with an arrow
  const items = optionItems(node);
  const sel = items[node.props.selected ?? -1];
  const shown = { ...node, props: { ...node.props, text: sel ? sel.text : "", toggle_mode: false } };
  drawButton(ctx, game, shown, r, node);
  const c = node.props.disabled ? THEME.fontDisabled : THEME.fontColor;
  const ax = r.w - ARROW / 2 - THEME.pad / 2, ay = r.h / 2;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(ax - 5, ay - 3);
  ctx.lineTo(ax + 5, ay - 3);
  ctx.lineTo(ax, ay + 3);
  ctx.closePath();
  ctx.fill();
}

function drawSlider(ctx, game, node, r) {
  const p = node.props;
  const min = p.min_value ?? 0, max = p.max_value ?? 100;
  const k = max > min ? ((p.value ?? 0) - min) / (max - min) : 0;
  const v = node.type === "VSlider";
  const sbSlider = p["theme_override_styles/slider"], sbArea = p["theme_override_styles/grabber_area"];
  const along = v ? r.h : r.w, across = v ? r.w : r.h;
  const pos = GRABBER / 2 + k * (along - GRABBER);
  const track = 4;
  const rect = (a, b, c, d) => (v ? [b, along - a - c, d, c] : [a, b, c, d]); // along / across -> x, y, w, h
  if (sbSlider) drawStyleBox(ctx, game, sbSlider, ...rect(0, (across - track) / 2, along, track));
  else {
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(...rect(0, (across - track) / 2, along, track));
  }
  if (sbArea) drawStyleBox(ctx, game, sbArea, ...rect(0, (across - track) / 2, pos, track));
  else {
    ctx.fillStyle = ui.hover === node || ui.drag === node ? "rgba(255, 255, 255, 0.55)" : "rgba(255, 255, 255, 0.35)";
    ctx.fillRect(...rect(0, (across - track) / 2, pos, track));
  }
  const tex = p["theme_override_icons/grabber"] || (ui.hover === node && p["theme_override_icons/grabber_highlight"]);
  const img = tex && game && game.texture(tex.$res);
  const [gx, gy] = v ? [across / 2, along - pos] : [pos, across / 2];
  if (img) {
    const w = img.img.width, h = img.img.height;
    ctx.drawImage(img.img, gx - w / 2, gy - h / 2, w, h);
  } else {
    ctx.fillStyle = p.editable === false ? THEME.fontDisabled : ui.hover === node || ui.drag === node ? THEME.fontPressed : THEME.fontColor;
    ctx.beginPath();
    ctx.arc(gx, gy, GRABBER / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawScrollbars(ctx, node, r) {
  const sc = scrollInfo(node);
  const p = node.props;
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
  const show = (mode, max) => mode === 2 || (mode !== 3 && mode !== 0 && max > 0);
  if (show(p.vertical_scroll_mode ?? 1, sc.maxY)) {
    const h = Math.max(20, (r.h * r.h) / Math.max(r.h, sc.ch));
    const y = sc.maxY ? ((p.scroll_vertical || 0) / sc.maxY) * (r.h - h) : 0;
    ctx.fillRect(r.w - SCROLLBAR + 3, y, SCROLLBAR - 5, h);
  }
  if (show(p.horizontal_scroll_mode ?? 1, sc.maxX)) {
    const w = Math.max(20, (r.w * r.w) / Math.max(r.w, sc.cw));
    const x = sc.maxX ? ((p.scroll_horizontal || 0) / sc.maxX) * (r.w - w) : 0;
    ctx.fillRect(x, r.h - SCROLLBAR + 3, w, SCROLLBAR - 5);
  }
}

function drawButton(ctx, game, node, r, real = node) {
  const p = node.props;
  const disabled = !!p.disabled;
  const pressed = (p.toggle_mode && p.button_pressed) || ui.down === real || (ui.popup && ui.popup.node === real);
  const hover = ui.hover === real && !disabled;
  const state = disabled ? "disabled" : pressed ? (hover ? "hover_pressed" : "pressed") : hover ? "hover" : "normal";
  const sb = p[`theme_override_styles/${state}`] || (state === "hover_pressed" && p["theme_override_styles/pressed"]) || p["theme_override_styles/normal"];
  if (sb) drawStyleBox(ctx, game, sb, 0, 0, r.w, r.h);
  else if (!p.flat) {
    ctx.fillStyle = THEME[state === "hover_pressed" ? "pressed" : state];
    ctx.fillRect(0, 0, r.w, r.h);
  }
  const c = (k) => p[`theme_override_colors/${k}`];
  const col = disabled ? c("font_disabled_color") || null : pressed ? c(hover ? "font_hover_pressed_color" : "font_pressed_color") || null : hover ? c("font_hover_color") || null : null;
  const fallback = disabled ? THEME.fontDisabled : pressed ? THEME.fontPressed : hover ? THEME.fontHover : THEME.fontColor;
  const text = textOf(node);
  const css = col ? cssColor(col) : c("font_color") && !hover && !pressed && !disabled ? cssColor(c("font_color")) : fallback;
  // the icon (tinted with icon_*_color), at the button's alignment
  const icon = p.icon && p.icon.$res && game && game.texture(p.icon.$res);
  if (icon) {
    const ic = (k) => p[`theme_override_colors/icon_${k}`];
    const icol = disabled ? ic("disabled_color") : pressed ? ic(hover ? "hover_pressed_color" : "pressed_color") : hover ? ic("hover_color") : ic("normal_color");
    const maxW = p["theme_override_constants/icon_max_width"] || 0;
    let w = icon.img.width, h = icon.img.height;
    if (maxW && w > maxW) [w, h] = [maxW, (h * maxW) / w];
    const al = p.icon_alignment ?? 0;
    const x = text ? THEME.pad : al === 1 ? (r.w - w) / 2 : al === 2 ? r.w - w - THEME.pad : THEME.pad;
    ctx.drawImage(tintedIcon(icon.img, icol ? cssColor(icol) : null), x, (r.h - h) / 2, w, h);
  }
  if (text) drawText(ctx, node, text, r, css, p.alignment ?? 1, 1);
}

// a white icon multiplied by a color (cached)
const tints = new Map();
function tintedIcon(img, css) {
  if (!css || typeof document === "undefined") return img;
  const key = `${img.src || ""}|${css}`;
  if (!tints.has(key)) {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const cx = c.getContext("2d");
    cx.drawImage(img, 0, 0);
    cx.globalCompositeOperation = "multiply";
    cx.fillStyle = css;
    cx.fillRect(0, 0, c.width, c.height);
    cx.globalCompositeOperation = "destination-in";
    cx.drawImage(img, 0, 0);
    tints.set(key, c);
  }
  return tints.get(key);
}

function drawEdit(ctx, game, node, r) {
  const p = node.props;
  const sb = p["theme_override_styles/normal"];
  if (sb) drawStyleBox(ctx, game, sb, 0, 0, r.w, r.h);
  else {
    ctx.fillStyle = THEME.edit;
    ctx.fillRect(0, 0, r.w, r.h);
  }
  if (ui.focus === node) {
    ctx.strokeStyle = THEME.focusBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, r.w - 1, r.h - 1);
  }
  const text = String(p.text ?? "");
  const lines = node.type === "TextEdit" ? text.split("\n") : [text];
  const caret = ui.focus === node && ui.caret ? "|" : "";
  const placeholder = !text && p.placeholder_text ? GAME?.tr(p.placeholder_text) : "";
  const shown = placeholder ? [placeholder] : lines.map((l, i) => (i === lines.length - 1 ? l + caret : l));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, r.w, r.h);
  ctx.clip();
  drawText(ctx, node, shown.join("\n"), { x: 0, y: 0, w: r.w, h: r.h }, placeholder ? THEME.fontDisabled : THEME.fontColor, 0, node.type === "TextEdit" ? 0 : 1, 6);
  ctx.restore();
}

// text in a control's rectangle (its own font, or the browser's at the theme size)
function drawText(ctx, node, text, r, css, ha, va, pad = 0) {
  const lines = text.split("\n");
  const f = fontFor(node);
  if (f && f.font) {
    ctx.save();
    ctx.translate(pad, pad);
    drawLines(ctx, f, lines, { w: r.w - pad * 2, h: r.h - pad * 2 }, css, {}, ha, va);
    ctx.restore();
    return;
  }
  const size = node.props["theme_override_font_sizes/font_size"] || THEME.fontSize;
  ctx.font = `${size}px system-ui, sans-serif`;
  ctx.fillStyle = css;
  ctx.textBaseline = "top";
  const lh = size * 1.3, total = lines.length * lh;
  const y0 = va === 1 ? (r.h - total) / 2 : va === 2 ? r.h - total - pad : pad;
  lines.forEach((l, i) => {
    const w = ctx.measureText(l).width;
    const x = ha === 1 ? (r.w - w) / 2 : ha === 2 ? r.w - w - pad : pad;
    ctx.fillText(l, x, y0 + i * lh);
  });
  ctx.textBaseline = "alphabetic";
}

function drawLabel(ctx, game, node, r) {
  const p = node.props;
  const text = translates(node) ? game.tr(String(p.text || "")) : String(p.text || "");
  if (!text) return;
  const res = p["theme_override_fonts/font"] && p["theme_override_fonts/font"].$res;
  const f = game.resolveFont(res, p["theme_override_font_sizes/font_size"]);
  const col = cssColor(p["theme_override_colors/font_color"] || { type: "Color", args: [1, 1, 1, 1] });
  const lines = text.split("\n");
  if (!f || !f.font) {
    // no font of its own (theme fonts aren't followed yet): the browser's
    ctx.font = `${p["theme_override_font_sizes/font_size"] || 16}px system-ui, sans-serif`;
    ctx.fillStyle = col;
    ctx.textBaseline = "top";
    const lh = (p["theme_override_font_sizes/font_size"] || 16) * 1.2;
    const total = lines.length * lh;
    const y0 = p.vertical_alignment === 1 ? (r.h - total) / 2 : p.vertical_alignment === 2 ? r.h - total : 0;
    lines.forEach((l, i) => {
      const w = ctx.measureText(l).width;
      const x = p.horizontal_alignment === 1 ? (r.w - w) / 2 : p.horizontal_alignment === 2 ? r.w - w : 0;
      ctx.fillText(l, x, y0 + i * lh);
    });
    ctx.textBaseline = "alphabetic";
    return;
  }
  drawLines(ctx, f, lines, r, col, labelStyle(p), p.horizontal_alignment || 0, p.vertical_alignment || 0);
}

/** Outline and shadow of a Label (theme overrides). */
function labelStyle(p) {
  const c = (k) => p[`theme_override_colors/${k}`];
  return {
    outline: p["theme_override_constants/outline_size"] || 0,
    outlineColor: c("font_outline_color") ? cssColor(c("font_outline_color")) : "#000",
    shadow: c("font_shadow_color") ? cssColor(c("font_shadow_color")) : null,
    shadowX: p["theme_override_constants/shadow_offset_x"] ?? 1,
    shadowY: p["theme_override_constants/shadow_offset_y"] ?? 1,
  };
}

/**
 * Lines of text in a rectangle with alignment (0 left/top, 1 center, 2
 * right/bottom), a shadow and an outline. Bitmap fonts have no outline (as in
 * Godot); TTFs draw it.
 */
function drawLines(ctx, f, lines, r, col, st = {}, ha = 0, va = 0) {
  const lh = f.font.lineHeightAt(f.size) + (f.lineSep || 0);
  const total = lines.length * lh;
  const y0 = va === 1 ? (r.h - total) / 2 : va === 2 ? r.h - total : 0;
  const opts = { ...f, outline: f.outline || st.outline || 0, outlineColor: f.outlineColor || st.outlineColor };
  lines.forEach((l, i) => {
    const w = f.font.measure(l, f.size);
    const x = Math.round(ha === 1 ? (r.w - w) / 2 : ha === 2 ? r.w - w : 0), y = Math.round(y0 + i * lh);
    if (st.shadow) f.font.draw(ctx, l, x + st.shadowX, y + st.shadowY, st.shadow, f.size, { ...opts, outline: 0 });
    f.font.draw(ctx, l, x, y, col, f.size, opts);
  });
}

export { color };
