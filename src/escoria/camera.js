// The room camera: Escoria's ESCCamera (game/scenes/camera_player/esc_camera.gd)
// over Godot's Camera2D as camera.tscn sets it (drag margins on, 0.2 of half
// the screen per side; anchor at the center), plus main.gd set_camera_limits().
// Escoria, MIT license, (c) Godot Escoria contributors.
//
// `pos` is the Camera2D's global_position (where it is told to look); the
// screen center follows it inside the drag margins and is then kept inside
// the limits. Zoom is Godot 4's: 2 shows things twice as big.
import { globalTransform, apply } from "../godot/render.js";

const DRAG_MARGIN = 0.2;

// Tween.TRANS_* with EASE_IN_OUT (Robert Penner's equations)
const easeIn = {
  LINEAR: (t) => t,
  SINE: (t) => 1 - Math.cos((t * Math.PI) / 2),
  QUAD: (t) => t * t,
  CUBIC: (t) => t * t * t,
  QUART: (t) => t ** 4,
  QUINT: (t) => t ** 5,
  EXPO: (t) => (t === 0 ? 0 : 2 ** (10 * (t - 1)) - 0.001),
  CIRC: (t) => 1 - Math.sqrt(1 - t * t),
  BACK: (t) => t * t * (2.70158 * t - 1.70158),
  ELASTIC: (t) => (t === 0 || t === 1 ? t : -(2 ** (10 * (t - 1))) * Math.sin(((t - 1 - 0.075) * 2 * Math.PI) / 0.3)),
  BOUNCE: (t) => 1 - bounceOut(1 - t),
};
function bounceOut(t) {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
  if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
  return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
}
export const TRANSITION_TYPES = Object.keys(easeIn);
const easeInOut = (type, t) => {
  const f = easeIn[type] || easeIn.LINEAR;
  return t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2;
};

export class EscCamera {
  constructor(esc, width, height) {
    this.esc = esc;
    this.W = width;
    this.H = height;
    this.reset();
  }

  /** A new room: a new camera (esc_room_manager.gd adds one per room). */
  reset() {
    this.pos = { x: 0, y: 0 };
    this.center = null; // the drag state; null: the next frame takes pos (first frame of a current camera)
    this.zoom = 1;
    this.limits = { left: -1e7, right: 1e7, top: -1e7, bottom: 1e7 };
    this.limitId = 0;
    this.follow = null; // EscObject (movable) the camera follows
    this.tween = null;
    this.drag = true;
    this.offset = { x: 0, y: 0 }; // Camera2D.offset (a game's shake)
  }

  // ---------------------------------------------------------------- limits

  /** main.gd set_camera_limits(): the room's camera_limits[id] (an empty one: the viewport). */
  setLimits(id = 0) {
    const all = (this.esc.view && this.esc.view.limits) || [];
    if (id < 0 || id >= all.length) {
      this.esc.log(`Camera limit ${id} requested. Last available camera limit is ${all.length - 1}.`, "error");
      return false;
    }
    let r = all[id];
    // an empty one: the ESCBackground's area (get_full_area_rect2()), the
    // viewport if that is smaller
    if (!r.w && !r.h) {
      r = { x: 0, y: 0, w: this.W, h: this.H };
      const room = this.esc.view && this.esc.view.room;
      const bg = room && room.children.find((c) => c.scriptName === "esc_background");
      if (bg) {
        const tex = bg.props.texture && this.esc.game.texture(bg.props.texture);
        const sc = bg.props.scale && bg.props.scale.args ? bg.props.scale.args : [1, 1];
        const w = (tex ? tex.sw : (bg.props.offset_right ?? 0) - (bg.props.offset_left ?? 0)) * sc[0];
        const h = (tex ? tex.sh : (bg.props.offset_bottom ?? 0) - (bg.props.offset_top ?? 0)) * sc[1];
        const x = bg.props.offset_left ?? (bg.props.position && bg.props.position.args ? bg.props.position.args[0] : 0);
        const y = bg.props.offset_top ?? (bg.props.position && bg.props.position.args ? bg.props.position.args[1] : 0);
        // (Godot compares Vector2 x first, then y)
        if (w > 0 && h > 0 && (w > this.W || (w === this.W && h >= this.H))) r = { x, y, w, h };
      }
    }
    this.limits = { left: r.x, right: r.x + r.w, top: r.y, bottom: r.y + r.h };
    this.limitId = id;
    return true;
  }

  get limitCount() {
    return ((this.esc.view && this.esc.view.limits) || []).length;
  }

  half() {
    return { x: this.W / 2 / this.zoom, y: this.H / 2 / this.zoom };
  }

  // Camera2D: the screen center for a camera center, kept inside the limits
  clampCenter(c) {
    const h = this.half(), l = this.limits;
    let x = c.x, y = c.y;
    if (x + h.x > l.right) x = l.right - h.x;
    if (x - h.x < l.left) x = l.left + h.x;
    if (y + h.y > l.bottom) y = l.bottom - h.y;
    if (y - h.y < l.top) y = l.top + h.y;
    return { x, y };
  }

  /** check_point_is_inside_viewport_limits() */
  insideViewportLimits(p) {
    const l = this.limits;
    const x = l.left + this.W / 2, y = l.top + this.H / 2;
    return p.x >= x && p.y >= y && p.x < x + (l.right - l.left - this.W + 1) && p.y < y + (l.bottom - l.top - this.H + 1);
  }

  /** clamp_to_viewport_limits() */
  clampToViewportLimits() {
    this.pos = this.clampCenter(this.screenCenter());
  }

  // ---------------------------------------------------------------- targets

  // _resolve_target_and_zoom(): {pos, zoom, follow}
  resolve(target) {
    if (!target) return { pos: { ...this.pos }, zoom: null, follow: null };
    if (target.x !== undefined && target.node === undefined) return { pos: { x: target.x, y: target.y }, zoom: null, follow: null };
    const n = target.node;
    const follow = n.props.is_movable ? target : null;
    // ESCItem get_camera_node(): a node of the item, else the item
    const camPath = n.props.camera_node && (n.props.camera_node.args ? n.props.camera_node.args[0] : n.props.camera_node);
    const camNode = camPath ? n.getNode(camPath) : null;
    if (camNode) {
      const pos = apply(globalTransform(camNode), { x: 0, y: 0 });
      const z = camNode.type === "Camera2D" && camNode.props.zoom ? camNode.props.zoom.args[0] : null;
      return { pos, zoom: z, follow };
    }
    return { pos: { ...target.position }, zoom: null, follow };
  }

  /** set_target(): an object (followed if it moves) or a point, in `time` seconds. */
  setTarget(target, time = 0) {
    const r = this.resolve(target);
    this.follow = r.follow;
    if (!time) {
      this.stopTween();
      this.pos = r.pos;
      if (this.center) this.applyDrag(); // a tween right after starts from what this frame shows
      return;
    }
    this.startTween({ pos: this.dragFree(r.pos) }, time, "LINEAR");
  }

  /** set_camera_zoom() */
  setZoom(level, time = 0) {
    if (level <= 0) return this.esc.log("Tried to set negative or zero zoom level.", "error");
    if (!time) {
      this.zoom = level;
      return;
    }
    this.startTween({ zoom: level }, time, "LINEAR");
  }

  /** push(): like set_target, with the target's camera zoom and a transition type. */
  push(target, time = 0, type = "QUAD") {
    const r = this.resolve(target);
    this.follow = r.follow;
    if (!time) {
      this.stopTween();
      this.pos = r.pos;
      if (r.zoom) this.zoom = r.zoom;
      if (this.center) this.applyDrag();
      return;
    }
    this.startTween(r.zoom ? { pos: r.pos, zoom: r.zoom } : { pos: r.pos }, time, type);
  }

  /** shift(): moves by (dx, dy). */
  shift(dx, dy, time = 1, type = "QUAD") {
    this.follow = null;
    const to = { x: this.pos.x + dx, y: this.pos.y + dy };
    this.startTween({ pos: to }, time, type);
  }

  // set_drag_margin_enabled(false) + _convert_current_global_pos_for_disabled_drag_margin()
  dragOff() {
    this.drag = false;
    this.pos = this.clampCenter(this.screenCenter());
  }
  dragFree(p) {
    this.dragOff();
    return this.clampCenter(p);
  }

  // ---------------------------------------------------------------- tween

  startTween(props, time, type) {
    this.stopTween();
    this.dragOff();
    const from = { pos: { ...this.pos }, zoom: this.zoom };
    return new Promise((done) => {
      this.tween = { from, to: props, t: 0, time, type, done };
    });
  }

  stopTween() {
    const tw = this.tween;
    this.tween = null;
    if (tw) tw.done();
  }

  /** Resolves when the running tween ends (camera_set_target_block). */
  tweenFinished() {
    const tw = this.tween;
    if (!tw) return Promise.resolve();
    return new Promise((ok) => {
      const prev = tw.done;
      tw.done = () => (prev(), ok());
    });
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    const tw = this.tween;
    if (tw) {
      tw.t += dt;
      const k = Math.min(tw.t / tw.time, 1), e = easeInOut(tw.type, k);
      if (tw.to.pos) this.pos = { x: tw.from.pos.x + (tw.to.pos.x - tw.from.pos.x) * e, y: tw.from.pos.y + (tw.to.pos.y - tw.from.pos.y) * e };
      if (tw.to.zoom) this.zoom = tw.from.zoom + (tw.to.zoom - tw.from.zoom) * e;
      if (k >= 1) {
        this.stopTween();
        this.drag = true; // _target_reached()
      }
    } else if (this.follow && this.follow.node.parent) {
      this.pos = { ...this.follow.position };
    }
    this.applyDrag();
  }

  // Camera2D drag: the center moves only when pos leaves the margins
  applyDrag() {
    const c = this.center;
    if (!c || !this.drag) this.center = { ...this.pos };
    else {
      const h = this.half();
      c.x = Math.max(Math.min(c.x, this.pos.x + h.x * DRAG_MARGIN), this.pos.x - h.x * DRAG_MARGIN);
      c.y = Math.max(Math.min(c.y, this.pos.y + h.y * DRAG_MARGIN), this.pos.y - h.y * DRAG_MARGIN);
    }
  }

  /** get_screen_center_position() */
  screenCenter() {
    return this.clampCenter(this.center || this.pos);
  }

  /** The room -> screen transform for this frame. */
  transform() {
    const c = this.screenCenter(), h = this.half(), z = this.zoom, o = this.offset || { x: 0, y: 0 };
    return [z, 0, 0, z, -(c.x + o.x - h.x) * z, -(c.y + o.y - h.y) * z];
  }
}
