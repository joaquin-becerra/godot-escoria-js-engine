// Godot's Object / Node API over the engine's nodes, for code translated from
// GDScript (tools/gd2js). A script attached to a node *is* that node: the
// translated class extends GdNode and wraps the engine node.
import { Vector2, Rect2, fromEngine, toEngine, truthy } from "./values.js";
import { AnimPlayer } from "../animation_player.js";
import { Node } from "../scene.js";
import { globalTransform, apply, multiply as multiplyXf } from "../render.js";
import { optionItems, setRangeValue, scrollBy, scrollInfo, controlRect, minSize, drawStyleBox } from "../controls.js";
import { cssColor } from "../values.js";
import { propsProxy, GdResource } from "./resources.js";
import { playAudio } from "../../escoria/audio.js";

import { Signal, Callable, GdObject } from "./object.js";
export { Signal, Callable, GdObject };

// signals a node exposes as properties (pressed, timeout...)
const SIGNAL_PROPS = ["pressed", "toggled", "timeout", "animation_finished", "frame_changed", "visibility_changed", "ready", "tree_exited", "tree_exiting",
  "tree_entered", "mouse_entered", "mouse_exited", "text_changed", "text_submitted", "value_changed", "item_selected", "finished", "child_entered_tree",
  "child_exiting_tree", "input_event", "gui_input", "resized", "focus_entered", "focus_exited", "renamed", "item_rect_changed", "button_down", "button_up",
  "drag_started", "drag_ended", "animation_looped", "sprite_frames_changed"];

// a bridge Color (r, g, b, a) as css
const cssOf = (c) => (c && c.r !== undefined ? `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a ?? 1})` : cssColor(c));

/** First argument of `new Cls(ATTACH, engineNode)`: the bridge attaches a script to an existing node. */
export const ATTACH = Symbol("attach");
/** The arguments a translated class's _init() gets (none when the bridge made it). */
export const initArgs = (a) => (a[0] === ATTACH || a[0] instanceof Node ? [] : a);
/** The script instance (or wrapper) of an engine node, if it has one. */
export const wrapperOf = (node) => wrappers.get(node) || null;

// ---------------------------------------------------------------- nodes

const wrappers = new WeakMap(); // engine node -> GdNode

/**
 * A Godot node over an engine Node. Properties map to the engine node's
 * props (converted: Vector2, Color...); see PROPS.
 */
export class GdNode extends GdObject {
  static gdClass = "Node";

  // new Cls(engineNode[, bridge]), new Cls(ATTACH, engineNode), or new Cls(...args of
  // the script's _init) from script code: then a new engine node of the class
  constructor(...a) {
    super();
    let node = a[0] === ATTACH ? a[1] : a[0] instanceof Node ? a[0] : null;
    const bridge = a[0] instanceof Node ? a[1] : null;
    if (!node) node = new Node(new.target.gdClass || "Node", new.target.gdClass || "Node");
    this.__node = node;
    this.__bridge = bridge || GdNode.defaultBridge;
    this.__processing = true;
    // properties the class doesn't define read and write the node's props
    // (script vars of Escoria nodes: tooltip_name, custom_data...)
    const proxy = propsProxy(this, (t) => t.__node.props);
    wrappers.set(node, proxy);
    return proxy;
  }

  /** The GdNode for an engine node (the script instance if it has one). */
  static wrap(node, bridge) {
    if (!node) return null;
    if (wrappers.has(node)) return wrappers.get(node);
    // nodes with Escoria's scripts (esc_item.gd...) get Escoria's classes
    const Cls = (GdNode.scriptClasses && GdNode.scriptClasses[node.scriptName]) || CLASSES[node.type] || GdNode;
    return new Cls(node, bridge);
  }

  /** @export var: the value the scene gives it, else the script's default */
  __export(name, def) {
    const v = this.__node.props[name];
    return v === undefined ? def : fromEngine(v);
  }

  // ---- tree
  get name() { return this.__node.name; }
  set name(v) { this.__node.name = v; }
  get_name() { return this.__node.name; }
  get_parent() { return GdNode.wrap(this.__node.parent, this.__bridge); }
  get_children() { return this.__node.children.map((c) => GdNode.wrap(c, this.__bridge)); }
  get_child(i) { const c = this.__node.children; return GdNode.wrap(c[i < 0 ? c.length + i : i], this.__bridge); }
  get_child_count() { return this.__node.children.length; }
  get_node(path) {
    const n = this.get_node_or_null(path);
    if (!n) throw new Error(`get_node: no node "${path}" from ${this.__node.name}`);
    return n;
  }
  get_node_or_null(path) {
    path = String(path);
    let n;
    if (path.startsWith("%")) {
      // unique name: anywhere in the scene this node belongs to
      let root = this.__node;
      while (root.parent && !root.sceneFile) root = root.parent;
      const want = path.slice(1).split("/")[0];
      n = root.find((x) => x.name === want);
      const rest = path.slice(1).split("/").slice(1).join("/");
      if (n && rest) n = n.getNode(rest);
    } else n = this.__node.getNode(path);
    return n ? GdNode.wrap(n, this.__bridge) : null;
  }
  has_node(path) { return !!this.get_node_or_null(path); }
  find_child(pattern) {
    const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    const n = this.__node.find((x) => x !== this.__node && re.test(x.name));
    return n ? GdNode.wrap(n, this.__bridge) : null;
  }
  // added under a node in the tree: the new subtree enters it (_ready, node_added)
  add_child(child) {
    if (child.__node.parent) child.__node.parent.remove(child.__node);
    this.__node.add(child.__node);
    this.signal("child_entered_tree").emit(child);
    if (this.__bridge.inTree(this.__node)) this.__bridge.enterTree(child.__node);
  }
  add_sibling(n) { this.get_parent()?.add_child(n); }
  remove_child(child) {
    this.signal("child_exiting_tree").emit(child);
    this.__node.remove(child.__node);
  }
  reparent(p) { p.add_child(this); }
  queue_free() {
    if (this.__freed) return;
    this.signal("tree_exiting").emit();
    if (this.__node.parent) this.__node.parent.remove(this.__node);
    for (const n of this.__node.walk()) {
      const w = wrappers.get(n);
      if (w && w !== this) w.__freed = true;
    }
    this.__freed = true;
    this.signal("tree_exited").emit();
  }
  free() { this.queue_free(); }
  is_inside_tree() { return !!this.__node.parent || !!this.__node.sceneFile; }
  get_tree() { return this.__bridge.tree; }
  get_viewport() { return this.__bridge.viewport; }
  is_processing_input() { return this.__input !== false; }
  is_processing_unhandled_input() { return this.__input !== false; }

  // ---- CanvasItem drawing: _draw() / the draw signal, every frame (queue_redraw is implicit)
  get draw() {
    this.__node.state.customDraw = true;
    return this.signal("draw");
  }
  get __ctx() {
    const c = this.__bridge.drawCtx;
    if (!c) throw new Error("draw_*() outside _draw()");
    return c;
  }
  __stroke(color, width) {
    const c = this.__ctx;
    c.strokeStyle = cssOf(color);
    c.lineWidth = width > 0 ? width : 1;
    return c;
  }
  draw_line(a, b, color, width = -1) {
    const c = this.__stroke(color, width);
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
  }
  draw_dashed_line(a, b, color, width = -1, dash = 2) {
    const c = this.__stroke(color, width);
    c.setLineDash([dash, dash]);
    this.draw_line(a, b, color, width);
    c.setLineDash([]);
  }
  draw_polyline(points, color, width = -1) {
    const c = this.__stroke(color, width);
    c.beginPath();
    [...points].forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.stroke();
  }
  draw_multiline(points, color, width = -1) {
    const pts = [...points];
    for (let i = 0; i + 1 < pts.length; i += 2) this.draw_line(pts[i], pts[i + 1], color, width);
  }
  draw_arc(center, radius, start, end, _points, color, width = -1) {
    const c = this.__stroke(color, width);
    c.beginPath();
    c.arc(center.x, center.y, radius, start, end, end < start);
    c.stroke();
  }
  draw_circle(center, radius, color, filled = true, width = -1) {
    const c = this.__ctx;
    c.beginPath();
    c.arc(center.x, center.y, radius, 0, Math.PI * 2);
    if (filled) {
      c.fillStyle = cssOf(color);
      c.fill();
    } else this.__stroke(color, width).stroke();
  }
  draw_rect(rect, color, filled = true, width = -1) {
    const c = this.__ctx;
    const { x, y } = rect.position, { x: w, y: h } = rect.size;
    if (filled) {
      c.fillStyle = cssOf(color);
      c.fillRect(x, y, w, h);
    } else this.__stroke(color, width).strokeRect(x, y, w, h);
  }
  draw_colored_polygon(points, color) {
    const c = this.__ctx;
    c.fillStyle = cssOf(color);
    c.beginPath();
    [...points].forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
    c.fill();
  }
  draw_polygon(points, colors) { this.draw_colored_polygon(points, colors[0]); }
  draw_texture(tex, pos, modulate = null) {
    const t = this.__texture(tex);
    if (!t) return;
    const c = this.__ctx;
    const a = c.globalAlpha;
    if (modulate) c.globalAlpha *= modulate.a;
    c.drawImage(t.img, pos.x, pos.y, t.img.width, t.img.height);
    c.globalAlpha = a;
  }
  draw_texture_rect(tex, rect, _tile = false, modulate = null) {
    const t = this.__texture(tex);
    if (!t) return;
    const c = this.__ctx;
    const a = c.globalAlpha;
    if (modulate) c.globalAlpha *= modulate.a;
    c.drawImage(t.img, rect.position.x, rect.position.y, rect.size.x, rect.size.y);
    c.globalAlpha = a;
  }
  draw_texture_rect_region(tex, rect, src, modulate = null) {
    const t = this.__texture(tex);
    if (!t) return;
    const c = this.__ctx;
    const a = c.globalAlpha;
    if (modulate) c.globalAlpha *= modulate.a;
    c.drawImage(t.img, src.position.x, src.position.y, src.size.x, src.size.y, rect.position.x, rect.position.y, rect.size.x, rect.size.y);
    c.globalAlpha = a;
  }
  __texture(tex) { return tex && tex.resource_path ? this.__bridge.game.texture(tex.resource_path) : null; }
  draw_string(font, pos, text, _align = 0, _width = -1, size = 16, color = null) {
    const f = font && font.resource_path ? this.__bridge.game.resolveFont(font.resource_path, size) : null;
    const c = this.__ctx;
    const css = color ? cssOf(color) : "#fff";
    if (f && f.font) {
      // pos is the baseline's left end
      f.font.draw(c, String(text), pos.x, pos.y - (f.font.ascentAt ? f.font.ascentAt(f.size) : f.font.lineHeightAt(f.size) * 0.8), css, f.size);
    } else {
      c.font = `${size}px system-ui, sans-serif`;
      c.fillStyle = css;
      c.fillText(String(text), pos.x, pos.y);
    }
  }
  draw_style_box(sb, rect) { drawStyleBox(this.__ctx, this.__bridge.game, sb && sb.__raw ? sb.__raw : sb, rect.position.x, rect.position.y, rect.size.x, rect.size.y); }
  draw_set_transform(pos, rot = 0, scale = null) {
    const c = this.__ctx, b = this.__bridge.drawBase;
    const s = scale || { x: 1, y: 1 };
    c.setTransform(b[0], b[1], b[2], b[3], b[4], b[5]);
    c.translate(pos.x, pos.y);
    c.rotate(rot);
    c.scale(s.x, s.y);
  }
  get_canvas_transform() { return null; }
  /** Its transform on the screen (with the camera): .origin, .x, .y */
  get_global_transform_with_canvas() {
    const m = multiplyXf(this.__bridge.esc.camera || [1, 0, 0, 1, 0, 0], globalTransform(this.__node));
    return { origin: new Vector2(m[4], m[5]), x: new Vector2(m[0], m[1]), y: new Vector2(m[2], m[3]) };
  }
  get_global_transform() {
    const m = globalTransform(this.__node);
    return { origin: new Vector2(m[4], m[5]), x: new Vector2(m[0], m[1]), y: new Vector2(m[2], m[3]) };
  }
  get_viewport_rect() { return new Rect2(0, 0, this.__bridge.viewport.size.x, this.__bridge.viewport.size.y); }
  get owner() { return null; }

  get scene_file_path() { return this.__node.sceneFile || ""; }
  call_deferred(name, ...args) { Promise.resolve().then(() => this[name](...args)); }
  get_window() { return this.__bridge.window; }

  // ---- metadata
  set_meta(k, v) { (this.__node.state.meta ||= {})[k] = v; }
  get_meta(k, def = null) { const m = this.__node.state.meta; return m && k in m ? m[k] : def; }
  has_meta(k) { const m = this.__node.state.meta; return !!m && k in m; }
  remove_meta(k) { if (this.__node.state.meta) delete this.__node.state.meta[k]; }
  get_meta_list() { return Object.keys(this.__node.state.meta || {}); }

  // ---- tweens
  create_tween() { return new GdTween(this.__bridge, this); }

  // ---- processing
  set_process(on) { this.__processing = !!on; }
  is_processing() { return this.__processing && typeof this._process === "function"; }
  set_physics_process() {}
  set_process_input(on) { this.__input = !!on; }
  set_process_unhandled_input(on) { this.__input = !!on; }
  get process_mode() { return this.__node.props.process_mode ?? 0; }
  set process_mode(v) { this.__node.props.process_mode = v; }

  // ---- visibility (CanvasItem)
  get visible() { return this.__node.props.visible !== false; }
  set visible(v) { this.__node.props.visible = !!truthy(v); this.signal("visibility_changed").emit(); }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  is_visible() { return this.visible; }
  set_visible(v) { this.visible = v; }
  is_visible_in_tree() {
    for (let n = this.__node; n; n = n.parent) if (n.props.visible === false) return false;
    return true;
  }
  get modulate() { return fromEngine(this.__node.props.modulate) || fromEngine({ type: "Color", args: [1, 1, 1, 1] }); }
  set modulate(c) { this.__node.props.modulate = toEngine(c); }
  get self_modulate() { return fromEngine(this.__node.props.self_modulate) || fromEngine({ type: "Color", args: [1, 1, 1, 1] }); }
  set self_modulate(c) { this.__node.props.self_modulate = toEngine(c); }
  get z_index() { return this.__node.props.z_index || 0; }
  set z_index(v) { this.__node.props.z_index = v; }
  queue_redraw() {}

  // ---- Node2D
  get position() { return fromEngine(this.__node.props.position) || new Vector2(); }
  set position(v) { this.__node.props.position = toEngine(new Vector2(v)); }
  set_position(v) { this.position = v; }
  get_position() { return this.position; }
  get global_position() {
    const p = apply(globalTransform(this.__node), { x: 0, y: 0 });
    return new Vector2(p.x, p.y);
  }
  set global_position(v) {
    const parent = this.__node.parent;
    const pp = parent ? this.get_parent().global_position : new Vector2();
    this.position = new Vector2(v.x - pp.x, v.y - pp.y);
  }
  get rotation() { return this.__node.props.rotation || 0; }
  set rotation(v) { this.__node.props.rotation = v; }
  get scale() { return fromEngine(this.__node.props.scale) || new Vector2(1, 1); }
  set scale(v) { this.__node.props.scale = toEngine(new Vector2(v)); }
}

// ---------------------------------------------------------------- node classes

// what Sprite2D and AnimatedSprite2D share (in Godot neither is the other)
const SpriteBase = (Base) => class extends Base {
  get offset() { return fromEngine(this.__node.props.offset) || new Vector2(); }
  set offset(v) { this.__node.props.offset = toEngine(new Vector2(v)); }
  get centered() { return this.__node.props.centered !== false; }
  set centered(v) { this.__node.props.centered = !!v; }
  get flip_h() { return !!this.__node.props.flip_h; }
  set flip_h(v) { this.__node.props.flip_h = !!v; }
  get flip_v() { return !!this.__node.props.flip_v; }
  set flip_v(v) { this.__node.props.flip_v = !!v; }
  get frame() { return this.__node.state.frame ?? this.__node.props.frame ?? 0; }
  set frame(v) { this.__node.props.frame = v; this.__node.state.frame = v; }
};

class GdSprite extends SpriteBase(GdNode) {
  static gdClass = "Sprite2D";
  get texture() { return fromEngine(this.__node.props.texture) ?? null; }
  set texture(v) { const raw = toEngine(v); this.__node.props.texture = raw; if (raw && raw.$res) this.__bridge.game.loadImagesIn(raw); }
}

class GdAnimatedSprite extends SpriteBase(GdNode) {
  static gdClass = "AnimatedSprite2D";
  get __anim() { return (this.__ap ||= new AnimPlayer(this.__node)); }
  get sprite_frames() { return fromEngine(this.__node.props.sprite_frames) ?? null; }
  set sprite_frames(v) { const raw = toEngine(v); this.__node.props.sprite_frames = raw; this.__bridge.game.loadImagesIn(raw); }
  get animation() { return this.__anim.current(); }
  set animation(v) { this.__node.state.animation = v; this.__node.props.animation = v; }
  play(name = "", speed = 1, backwards = false) {
    this.__anim.play(name || this.animation, backwards);
    this.__anim.finished().then(() => this.signal("animation_finished").emit());
  }
  play_backwards(name = "") { this.play(name, 1, true); }
  stop() { this.__anim.stop(); }
  pause() { this.__node.state.playing = false; }
  is_playing() { return this.__anim.isPlaying(); }
}

class GdAnimationPlayer extends GdNode {
  static gdClass = "AnimationPlayer";
  get __anim() { return (this.__ap ||= new AnimPlayer(this.__node)); }
  play(name = "", blend = -1, speed = 1, fromEnd = false) {
    this.__anim.play(name, fromEnd || speed < 0);
    this.__anim.finished().then(() => this.signal("animation_finished").emit(name));
  }
  play_backwards(name = "") { this.play(name, -1, -1, true); }
  stop() { this.__anim.stop(); }
  is_playing() { return this.__anim.isPlaying(); }
  has_animation(name) { return this.__anim.has(name); }
  get current_animation() { return this.__anim.current(); }
  get_animation_list() { return this.__anim.names(); }
  get_animation_library_list() { return Object.keys(this.__node.props.libraries || {}); }
  has_animation_library(name) { return String(name) in (this.__node.props.libraries || {}); }
  get_animation_library(name) { return fromEngine((this.__node.props.libraries || {})[String(name)]) ?? null; }
  get_animation(name) {
    const [lib, anim] = String(name).includes("/") ? String(name).split("/") : ["", String(name)];
    const l = (this.__node.props.libraries || {})[lib];
    return l && l.props && l.props._data ? fromEngine(l.props._data[anim]) ?? null : null;
  }
}

/** Controls: the rectangle (offsets), text, and the state of buttons. */
class GdControl extends GdNode {
  static gdClass = "Control";
  // the rectangle the layout gives it (anchors, offsets, its minimum size, a
  // container's arrangement), as Godot's position / size
  get position() { const r = controlRect(this.__node); return new Vector2(r.x, r.y); }
  set position(v) {
    const r = controlRect(this.__node), p = this.__node.props;
    const dx = v.x - r.x, dy = v.y - r.y;
    Object.assign(p, { offset_left: (p.offset_left || 0) + dx, offset_top: (p.offset_top || 0) + dy, offset_right: (p.offset_right || 0) + dx, offset_bottom: (p.offset_bottom || 0) + dy });
  }
  get size() { const r = controlRect(this.__node); return new Vector2(r.w, r.h); }
  set size(v) {
    const r = controlRect(this.__node), p = this.__node.props;
    p.offset_right = (p.offset_right || 0) + (v.x - r.w);
    p.offset_bottom = (p.offset_bottom || 0) + (v.y - r.h);
  }
  get text() { return this.__node.props.text ?? ""; }
  set text(v) { this.__node.props.text = String(v); }
  get disabled() { return !!this.__node.props.disabled; }
  set disabled(v) { this.__node.props.disabled = !!v; }
  get button_pressed() { return !!this.__node.props.button_pressed; }
  set button_pressed(v) { this.__node.props.button_pressed = !!v; }
  get mouse_filter() { return this.__node.props.mouse_filter ?? 0; }
  set mouse_filter(v) { this.__node.props.mouse_filter = v; }
  grab_focus() {}
  release_focus() {}
  accept_event() { this.__bridge.inputHandled = true; }
  get_local_mouse_position() { const m = this.__bridge.mouse || { x: 0, y: 0 }; const g = this.global_position; return new Vector2(m.x - g.x, m.y - g.y); }
  get_global_rect() { const g = this.global_position, s = this.size; return new Rect2(g.x, g.y, s.x, s.y); }
  get_rect() { const p = this.position, s = this.size; return new Rect2(p.x, p.y, s.x, s.y); }
  has_focus() { return false; }
  get custom_minimum_size() { return fromEngine(this.__node.props.custom_minimum_size) || new Vector2(); }
  set custom_minimum_size(v) { this.__node.props.custom_minimum_size = toEngine(new Vector2(v)); }
  get_minimum_size() { const m = minSize(this.__node); return new Vector2(m.w, m.h); }
  get_combined_minimum_size() { return this.get_minimum_size(); }
  set_anchors_preset(preset) {
    // the anchors of LayoutPreset (PRESET_FULL_RECT = 15...)
    const A = { 0: [0, 0, 0, 0], 1: [1, 0, 1, 0], 2: [0, 1, 0, 1], 3: [1, 1, 1, 1], 4: [0, 0.5, 0, 0.5], 5: [0.5, 0, 0.5, 0], 6: [1, 0.5, 1, 0.5], 7: [0.5, 1, 0.5, 1], 8: [0.5, 0.5, 0.5, 0.5], 9: [0, 0, 0, 1], 10: [0, 0, 1, 0], 11: [1, 0, 1, 1], 12: [0, 1, 1, 1], 13: [0.5, 0, 0.5, 1], 14: [0, 0.5, 1, 0.5], 15: [0, 0, 1, 1] }[preset];
    if (!A) return;
    const p = this.__node.props;
    [p.anchor_left, p.anchor_top, p.anchor_right, p.anchor_bottom] = A;
    p.anchors_preset = preset;
  }
  set_anchors_and_offsets_preset(preset) {
    this.set_anchors_preset(preset);
    const p = this.__node.props;
    p.offset_left = p.offset_top = p.offset_right = p.offset_bottom = 0;
  }

  // ---- theme: the scene's overrides (theme_override_<kind>/<name>)
  __override(kind, name) { return this.__node.props[`theme_override_${kind}/${name}`]; }
  __setOverride(kind, name, v) { this.__node.props[`theme_override_${kind}/${name}`] = toEngine(v); }
  __clearOverride(kind, name) { delete this.__node.props[`theme_override_${kind}/${name}`]; }
  add_theme_color_override(n, v) { this.__setOverride("colors", n, v); }
  add_theme_constant_override(n, v) { this.__setOverride("constants", n, v); }
  add_theme_font_override(n, v) { this.__setOverride("fonts", n, v); }
  add_theme_font_size_override(n, v) { this.__setOverride("font_sizes", n, v); }
  add_theme_stylebox_override(n, v) { this.__setOverride("styles", n, v); }
  add_theme_icon_override(n, v) { this.__setOverride("icons", n, v); }
  remove_theme_color_override(n) { this.__clearOverride("colors", n); }
  remove_theme_constant_override(n) { this.__clearOverride("constants", n); }
  remove_theme_font_override(n) { this.__clearOverride("fonts", n); }
  remove_theme_font_size_override(n) { this.__clearOverride("font_sizes", n); }
  remove_theme_stylebox_override(n) { this.__clearOverride("styles", n); }
  remove_theme_icon_override(n) { this.__clearOverride("icons", n); }
  has_theme_color_override(n) { return this.__override("colors", n) !== undefined; }
  has_theme_constant_override(n) { return this.__override("constants", n) !== undefined; }
  has_theme_font_override(n) { return this.__override("fonts", n) !== undefined; }
  has_theme_font_size_override(n) { return this.__override("font_sizes", n) !== undefined; }
  has_theme_stylebox_override(n) { return this.__override("styles", n) !== undefined; }
  has_theme_icon_override(n) { return this.__override("icons", n) !== undefined; }
  // the override, else what the theme of the control or an ancestor gives, else Godot's default
  __themed(kind, name) {
    for (let n = this.__node; n; n = n.parent) {
      const o = n.props[`theme_override_${kind}/${name}`];
      if (o !== undefined && n === this.__node) return o;
      const th = n.props.theme && this.__bridge.themeValue(n.props.theme, kind, n === this.__node ? this.__node.type : this.__node.type, name);
      if (th !== undefined) return th;
    }
    return undefined;
  }
  get_theme_color(n) { return fromEngine(this.__themed("colors", n)) || fromEngine({ type: "Color", args: n.includes("font") ? [0.875, 0.875, 0.875, 1] : [1, 1, 1, 1] }); }
  get_theme_constant(n) { return this.__themed("constants", n) ?? 0; }
  get_theme_font(n) { const f = this.__themed("fonts", n); return f ? fromEngine(f) : this.__bridge.defaultFont(); }
  get_theme_font_size(n) { return this.__themed("font_sizes", n) ?? 16; }
  get_theme_stylebox(n) { const s = this.__themed("styles", n); return s ? fromEngine(s) : new GdResource({ type: "StyleBoxEmpty", props: {} }, this.__bridge); }
  get_theme_icon(n) { const s = this.__themed("icons", n); return s ? fromEngine(s) : null; }
  get theme() { return fromEngine(this.__node.props.theme) ?? null; }
  set theme(v) { this.__node.props.theme = toEngine(v); }
}

/**
 * Tween: property tweens in sequence (or in parallel), over game time.
 * tween_property(obj, "prop", final, duration) -> PropertyTweener (from,
 * set_trans, set_ease, set_delay...); tween_interval, tween_callback;
 * the finished signal; await tween.finished.
 */
const EASES = {
  0: (t) => t, // TRANS_LINEAR
  1: (t) => 1 - Math.cos((t * Math.PI) / 2), // SINE (in)
  2: (t) => t ** 5, 3: (t) => t ** 4, 4: (t) => t * t, // QUINT, QUART, QUAD
  5: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)), // EXPO
  7: (t) => t * t * t, // CUBIC
  8: (t) => 1 - Math.sqrt(1 - t * t), // CIRC
};
function eased(trans, ease, t) {
  const f = EASES[trans] || EASES[0];
  if (trans === 0) return t;
  switch (ease) {
    case 0: return f(t); // EASE_IN
    case 1: return 1 - f(1 - t); // EASE_OUT
    case 2: return t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2; // EASE_IN_OUT
    default: return t < 0.5 ? (1 - f(1 - t * 2)) / 2 : 0.5 + f(t * 2 - 1) / 2; // EASE_OUT_IN
  }
}
const lerpValue = (a, b, k) => {
  if (typeof a === "number") return a + (b - a) * k;
  if (a instanceof Vector2) return new Vector2(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
  if (a && a.r !== undefined) return a.constructor === b.constructor ? new a.constructor(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k, a.a + (b.a - a.a) * k) : b;
  return k < 1 ? a : b;
};

class GdTween extends GdObject {
  constructor(bridge, owner = null) {
    super();
    this.__bridge = bridge;
    this.__owner = owner;
    this.__steps = []; // [[tweener...]] each step runs its tweeners together
    this.__parallel = false;
    this.__defaults = { trans: 0, ease: 2 };
    this.__time = 0;
    this.__running = true;
    this.__loops = 1;
    this.__started = false;
    bridge.tweens.add(this);
  }
  get finished() { return this.signal("finished"); }
  get step_finished() { return this.signal("step_finished"); }
  __add(tw) {
    if (this.__parallel && this.__steps.length) this.__steps[this.__steps.length - 1].push(tw);
    else this.__steps.push([tw]);
    this.__parallel = this.__allParallel || false;
    return tw;
  }
  tween_property(obj, prop, final, duration) {
    return this.__add(new PropertyTweener(this, obj, String(prop), final, duration));
  }
  tween_interval(t) { return this.__add(new Tweener(this, t)); }
  tween_callback(callable) { const tw = new Tweener(this, 0); tw.__cb = callable; return this.__add(tw); }
  tween_method(callable, from, to, duration) {
    const tw = new Tweener(this, duration);
    tw.__apply = (k) => callable.call(lerpValue(from, to, k));
    return this.__add(tw);
  }
  parallel() { this.__parallel = true; return this; }
  set_parallel(on = true) { this.__allParallel = !!on; this.__parallel = !!on; return this; }
  chain() { this.__parallel = false; return this; }
  set_trans(t) { this.__defaults.trans = t; return this; }
  set_ease(e) { this.__defaults.ease = e; return this; }
  set_loops(n = 0) { this.__loops = n; return this; }
  set_pause_mode() { return this; }
  set_process_mode() { return this; }
  bind_node() { return this; }
  set_speed_scale(s) { this.__speed = s; return this; }
  is_running() { return this.__running; }
  is_valid() { return !this.__killed; }
  pause() { this.__running = false; }
  play() { this.__running = true; }
  stop() { this.__running = false; this.__time = 0; }
  kill() { this.__killed = true; this.__running = false; this.__bridge.tweens.delete(this); }
  custom_step(dt) { this.__tick(dt); return !this.__killed; }
  __tick(dt) {
    if (!this.__running || this.__killed) return;
    if (this.__owner && this.__owner.__freed) return this.kill();
    dt *= this.__speed ?? 1;
    while (dt >= 0 && this.__steps.length) {
      const step = this.__steps[0];
      for (const tw of step) tw.__begin();
      const used = Math.max(...step.map((tw) => tw.__advance(dt)));
      if (!step.every((tw) => tw.__done)) return;
      this.__steps.shift();
      (this.__doneSteps ||= []).push(step);
      this.signal("step_finished").emit(0);
      dt -= used;
      if (dt <= 0 && this.__steps.length) return;
    }
    if (!this.__steps.length) {
      if (this.__loops === 0 || --this.__loops > 0) {
        this.__steps = this.__doneSteps.map((s) => s.map((tw) => tw.__reset()));
        this.__doneSteps = [];
        this.signal("loop_finished").emit(0);
        return;
      }
      this.__running = false;
      this.__bridge.tweens.delete(this);
      this.signal("finished").emit();
    }
  }
}

class Tweener extends GdObject {
  constructor(tween, duration) {
    super();
    this.__tween = tween;
    this.__duration = Math.max(0, Number(duration) || 0);
    this.__delay = 0;
    this.__t = 0;
    this.__done = false;
    this.__begun = false;
    this.__trans = tween.__defaults.trans;
    this.__ease = tween.__defaults.ease;
  }
  get finished() { return this.signal("finished"); }
  set_delay(d) { this.__delay = d; return this; }
  set_trans(t) { this.__trans = t; return this; }
  set_ease(e) { this.__ease = e; return this; }
  __begin() { this.__begun = true; }
  __reset() { this.__t = 0; this.__done = false; this.__begun = false; return this; }
  // advances; returns the time used
  __advance(dt) {
    if (this.__done) return 0;
    const before = this.__t;
    this.__t = Math.min(this.__t + dt, this.__delay + this.__duration);
    const k = this.__duration ? Math.max(0, this.__t - this.__delay) / this.__duration : this.__t >= this.__delay ? 1 : 0;
    if (this.__t >= this.__delay) this.__apply?.(eased(this.__trans, this.__ease, Math.min(1, k)));
    if (this.__t >= this.__delay + this.__duration) {
      this.__done = true;
      if (this.__cb) this.__cb.call();
      this.signal("finished").emit();
    }
    return this.__t - before;
  }
}

class PropertyTweener extends Tweener {
  constructor(tween, obj, prop, final, duration) {
    super(tween, duration);
    this.__obj = obj;
    this.__path = prop.split(":"); // "modulate:a"
    this.__final = final;
    this.__from = undefined;
    this.__relative = false;
  }
  __get() { let v = this.__obj; for (const k of this.__path) v = v[k]; return v; }
  __set(v) {
    if (this.__path.length === 1) this.__obj[this.__path[0]] = v;
    else {
      // modulate:a -> read the Color, change it, write it back
      const outer = this.__obj[this.__path[0]];
      outer[this.__path[1]] = v;
      this.__obj[this.__path[0]] = outer;
    }
  }
  from(v) { this.__from = v; return this; }
  from_current() { this.__from = undefined; return this; }
  as_relative() { this.__relative = true; return this; }
  __begin() {
    if (this.__begun) return;
    super.__begin();
    this.__start = this.__from !== undefined ? this.__from : this.__get();
    this.__end = this.__relative ? (typeof this.__start === "number" ? this.__start + this.__final : this.__final) : this.__final;
    if (this.__from !== undefined) this.__set(this.__from);
  }
  __reset() { super.__reset(); return this; }
  __apply(k) { this.__set(lerpValue(this.__start, this.__end, k)); }
}

/**
 * AudioStreamPlayer: plays its stream (an exported sound) on a bus; the
 * volume of the bus is the player's setting for it (Music, SFX, Speech,
 * Ambient), times volume_db.
 */
const BUS_SETTING = { Master: "master", Music: "music", SFX: "sfx", Sfx: "sfx", Effects: "sfx", Speech: "speech", Voice: "speech", Ambient: "ambient" };
class GdAudioStreamPlayer extends GdNode {
  static gdClass = "AudioStreamPlayer";
  constructor(...a) {
    super(...a);
    this.__audio = null;
  }
  __enterTree() { if (this.__node.props.autoplay && !this.__audio) this.play(); }
  get stream() { return fromEngine(this.__node.props.stream) ?? null; }
  set stream(s) { this.stop(); this.__node.props.stream = toEngine(s); }
  get bus() { return this.__node.props.bus || "Master"; }
  set bus(b) { this.__node.props.bus = String(b); this.__volume(); }
  get volume_db() { return this.__node.props.volume_db || 0; }
  set volume_db(v) { this.__node.props.volume_db = v; this.__volume(); }
  get playing() { return !!this.__audio && !this.__audio.paused && !this.__audio.ended; }
  set playing(v) { v ? this.play() : this.stop(); }
  get stream_paused() { return !!this.__paused; }
  set stream_paused(v) {
    this.__paused = !!v;
    if (!this.__audio) return;
    if (v) this.__audio.pause();
    else playAudio(this.__audio);
  }
  get finished() { return this.signal("finished"); }
  __gain() {
    const esc = this.__bridge.esc, s = esc.settings || {};
    if (esc.muted || this.__bridge.mutedBus(this.bus)) return 0;
    const bus = BUS_SETTING[this.bus];
    return Math.min(1, (s.master ?? 1) * (bus && bus !== "master" ? s[bus] ?? 1 : 1) * 10 ** (this.volume_db / 20));
  }
  __volume() { if (this.__audio) this.__audio.volume = this.__gain(); }
  play(from = 0) {
    const st = this.__node.props.stream;
    const path = st && st.$res;
    if (!path) return;
    this.stop();
    const game = this.__bridge.game;
    const a = new Audio(game.url((game.json.remap && game.json.remap[path]) || path));
    a.loop = !!(st.props && st.props.loop) || !!this.__loop;
    a.currentTime = from;
    a.volume = this.__gain();
    a.addEventListener("ended", () => {
      if (this.__audio === a) this.__audio = null;
      this.signal("finished").emit();
    });
    this.__audio = a;
    this.__paused = false;
    this.__bridge.players.add(this);
    playAudio(a);
  }
  stop() {
    if (this.__audio) this.__audio.pause();
    this.__audio = null;
    this.__bridge.players.delete(this);
  }
  get_playback_position() { return this.__audio ? this.__audio.currentTime : 0; }
  seek(t) { if (this.__audio) this.__audio.currentTime = t; }
  queue_free() { this.stop(); super.queue_free(); }
}

/** Range (HSlider, VSlider...): value within min / max, by steps; setting it emits value_changed. */
class GdRange extends GdControl {
  static gdClass = "Range";
  get value() { return this.__node.props.value ?? 0; }
  set value(v) { if (setRangeValue(this.__node, +v)) this.emit_signal("value_changed", this.value); }
  set_value(v) { this.value = v; }
  set_value_no_signal(v) { setRangeValue(this.__node, +v); }
  get_value() { return this.value; }
  get min_value() { return this.__node.props.min_value ?? 0; }
  set min_value(v) { this.__node.props.min_value = +v; }
  get max_value() { return this.__node.props.max_value ?? 100; }
  set max_value(v) { this.__node.props.max_value = +v; }
  get step() { return this.__node.props.step ?? 1; }
  set step(v) { this.__node.props.step = +v; }
  get ratio() { return this.max_value > this.min_value ? (this.value - this.min_value) / (this.max_value - this.min_value) : 0; }
  set ratio(r) { this.value = this.min_value + r * (this.max_value - this.min_value); }
  get editable() { return this.__node.props.editable !== false; }
  set editable(v) { this.__node.props.editable = !!v; }
}

/** OptionButton: the items, the selected one (select() from a script doesn't emit item_selected). */
class GdOptionButton extends GdControl {
  static gdClass = "OptionButton";
  get __items() { return optionItems(this.__node); }
  get selected() { return this.__node.props.selected ?? -1; }
  set selected(i) { this.select(i); }
  select(i) { this.__node.props.selected = i >= 0 && i < this.__items.length ? i : -1; }
  get_selected() { return this.selected; }
  get_selected_id() { const it = this.__items[this.selected]; return it ? it.id : -1; }
  get_item_count() { return this.__items.length; }
  get item_count() { return this.__items.length; }
  add_item(text, id = -1) {
    const items = this.__items;
    items.push({ text: String(text), id: id < 0 ? items.length : id, disabled: false });
    if (this.selected < 0) this.__node.props.selected = 0; // Godot selects the first item added
  }
  add_separator() {}
  clear() { this.__items.length = 0; this.__node.props.selected = -1; }
  remove_item(i) { this.__items.splice(i, 1); if (this.selected >= this.__items.length) this.__node.props.selected = this.__items.length - 1; }
  get_item_text(i) { return this.__items[i]?.text ?? ""; }
  set_item_text(i, s) { if (this.__items[i]) this.__items[i].text = String(s); }
  get_item_id(i) { return this.__items[i]?.id ?? -1; }
  set_item_id(i, id) { if (this.__items[i]) this.__items[i].id = id; }
  get_item_index(id) { return this.__items.findIndex((it) => it.id === id); }
  set_item_disabled(i, d) { if (this.__items[i]) this.__items[i].disabled = !!d; }
  is_item_disabled(i) { return !!this.__items[i]?.disabled; }
  set_item_metadata(i, m) { if (this.__items[i]) this.__items[i].meta = m; }
  get_item_metadata(i) { return this.__items[i]?.meta ?? null; }
  get_selected_metadata() { return this.get_item_metadata(this.selected); }
  /** The list (PopupMenu): its theme overrides and min_size style the list the engine draws. */
  get_popup() {
    const st = this.__node.state;
    if (!st.popup) {
      st.popup = new Node("popup", "PopupMenu");
      st.popup.parent = null;
    }
    return GdNode.wrap(st.popup, this.__bridge);
  }
}

/** PopupMenu (an OptionButton's list): theme overrides, min_size, about_to_popup. */
class GdPopupMenu extends GdControl {
  static gdClass = "PopupMenu";
  get min_size() { return (this.__node.state.minSize ||= new Vector2()); }
  set min_size(v) { this.__node.state.minSize = new Vector2(v); }
  get about_to_popup() { return this.signal("about_to_popup"); }
  get id_pressed() { return this.signal("id_pressed"); }
  get index_pressed() { return this.signal("index_pressed"); }
}

/** ScrollContainer: the scroll position (within what the content needs). */
class GdScrollContainer extends GdControl {
  static gdClass = "ScrollContainer";
  get scroll_vertical() { return this.__node.props.scroll_vertical || 0; }
  set scroll_vertical(v) { scrollBy(this.__node, 0, v - this.scroll_vertical); }
  get scroll_horizontal() { return this.__node.props.scroll_horizontal || 0; }
  set scroll_horizontal(v) { scrollBy(this.__node, v - this.scroll_horizontal, 0); }
  ensure_control_visible(c) {
    // scroll so that the control (a descendant) is inside
    const sc = scrollInfo(this.__node);
    let y = 0;
    for (let n = c.__node; n && n.parent !== this.__node; n = n.parent) y += controlRect(n).y;
    const top = y + this.scroll_vertical, h = controlRect(c.__node).h;
    if (top < this.scroll_vertical) this.scroll_vertical = top;
    else if (top + h > this.scroll_vertical + sc.h) this.scroll_vertical = top + h - sc.h;
  }
}

/** CanvasLayer: its children are drawn in screen space (not moved by the camera), in the order of `layer`. */
class GdCanvasLayer extends GdNode {
  static gdClass = "CanvasLayer";
  get layer() { return this.__node.props.layer ?? 1; }
  set layer(v) { this.__node.props.layer = Math.trunc(v); }
  get offset() { return fromEngine(this.__node.props.offset) || new Vector2(); }
  set offset(v) { this.__node.props.offset = toEngine(new Vector2(v)); }
  get follow_viewport_enabled() { return !!this.__node.props.follow_viewport_enabled; }
  set follow_viewport_enabled(v) { this.__node.props.follow_viewport_enabled = !!v; }
}

/** Timer: counts game time (esc.update) through the bridge's tick. */
class GdTimer extends GdNode {
  static gdClass = "Timer";
  constructor(...a) {
    super(...a);
    const p = this.__node.props;
    if (p.wait_time === undefined) p.wait_time = 1;
    if (p.one_shot === undefined) p.one_shot = false;
    p.time_left = 0;
    this.__running = false;
  }
  // autostart: when it enters the tree
  __enterTree() { if (this.__node.props.autostart && !this.__running) this.start(); }
  start(t = -1) {
    if (t > 0) this.wait_time = t;
    this.time_left = this.wait_time;
    this.__running = true;
    this.__bridge.timers.add(this);
  }
  stop() {
    this.__running = false;
    this.__bridge.timers.delete(this);
  }
  is_stopped() { return !this.__running; }
  get timeout() { return this.signal("timeout"); }
  __tick(dt) {
    if (!this.__running) return;
    this.time_left -= dt;
    if (this.time_left <= 0) {
      if (this.one_shot) this.stop();
      else this.time_left += this.wait_time;
      this.signal("timeout").emit();
    }
  }
}

// signals as properties on every node class
for (const name of SIGNAL_PROPS) {
  if (Object.getOwnPropertyDescriptor(GdNode.prototype, name)) continue;
  Object.defineProperty(GdNode.prototype, name, { get() { return this.signal(name); }, configurable: true });
}

export const CLASSES = {
  Node: GdNode, Node2D: GdNode, CanvasLayer: GdCanvasLayer, Area2D: GdNode, Marker2D: GdNode, Position2D: GdNode, Polygon2D: GdNode,
  CollisionShape2D: GdNode, CollisionPolygon2D: GdNode, NavigationRegion2D: GdNode, Camera2D: GdNode,
  Sprite2D: GdSprite, AnimatedSprite2D: GdAnimatedSprite, AnimationPlayer: GdAnimationPlayer, Timer: GdTimer,
  Control: GdControl, Label: GdControl, RichTextLabel: GdControl, Button: GdControl, TextureButton: GdControl, CheckBox: GdControl,
  LineEdit: GdControl, Panel: GdControl, PanelContainer: GdControl, ColorRect: GdControl, TextureRect: GdControl,
  VBoxContainer: GdControl, HBoxContainer: GdControl, GridContainer: GdControl, MarginContainer: GdControl, ScrollContainer: GdControl,
  TextEdit: GdControl, CenterContainer: GdControl,
  AudioStreamPlayer: GdAudioStreamPlayer, AudioStreamPlayer2D: GdAudioStreamPlayer, PopupMenu: GdPopupMenu,
  HSlider: GdRange, VSlider: GdRange, OptionButton: GdOptionButton, ScrollContainer: GdScrollContainer,
};
// each class answers to its Godot name (is_class, `is`, get_class)
for (const [name, Cls] of Object.entries(CLASSES)) if (!Object.hasOwn(Cls, "gdClass")) Object.defineProperty(Cls, "gdClass", { value: name });

/** A base class for translated scripts: `extends Node2D` -> base("Node2D"). */
export function baseClass(name) {
  const Base = CLASSES[name] || GdNode;
  if (Base.gdClass === name) return Base;
  // e.g. Node2D shares GdNode: a subclass that answers to its own name
  const C = class extends Base {};
  Object.defineProperty(C, "gdClass", { value: name });
  Object.defineProperty(C, "name", { value: name });
  return C;
}

/** `new` of a node class from script code: Timer.new(), AnimatedSprite2D.new()... */
export function newNode(name, bridge) {
  const node = new Node(name, name);
  return GdNode.wrap(node, bridge);
}

/** `value is Type` */
export function isType(v, type) {
  if (v === null || v === undefined) return false;
  switch (type) {
    case "int": return typeof v === "number" && Number.isInteger(v);
    case "float": return typeof v === "number";
    case "String": case "StringName": return typeof v === "string";
    case "bool": return typeof v === "boolean";
    case "Array": return Array.isArray(v);
    case "Dictionary": return v.constructor === Object;
    case "Vector2": return v instanceof Vector2;
    case "Callable": return v instanceof Callable;
    case "Object": return typeof v === "object";
  }
  if (v instanceof GdObject) {
    if (v.is_class(type)) return true;
    // the engine node's own type (a Button is a Control, a Sprite2D a Node2D)
    const t = v.__node && v.__node.type;
    return t === type || (INHERITS[t] || []).includes(type);
  }
  return !!(v.constructor && v.constructor.name === type);
}
const INHERITS = {
  Sprite2D: ["Node2D", "CanvasItem", "Node"], AnimatedSprite2D: ["Node2D", "CanvasItem", "Node"], Area2D: ["CollisionObject2D", "Node2D", "CanvasItem", "Node"],
  Button: ["BaseButton", "Control", "CanvasItem", "Node"], TextureButton: ["BaseButton", "Control", "CanvasItem", "Node"], CheckBox: ["Button", "BaseButton", "Control", "CanvasItem", "Node"],
  Label: ["Control", "CanvasItem", "Node"], LineEdit: ["Control", "CanvasItem", "Node"], Panel: ["Control", "CanvasItem", "Node"],
  Node2D: ["CanvasItem", "Node"], Control: ["CanvasItem", "Node"], Timer: ["Node"], AnimationPlayer: ["Node"],
};

/** What the node classes support (for the translator's report). */
export function nodeApi() {
  const names = new Set();
  for (const C of new Set(Object.values(CLASSES))) {
    for (let p = C.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) for (const k of Object.getOwnPropertyNames(p)) if (!k.startsWith("__") && k !== "constructor") names.add(k);
  }
  return names;
}
