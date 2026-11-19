// Godot's InputEvent classes for translated GDScript, made from the browser's
// events (fromKey, fromMouse). Actions (is_action_pressed) use Godot's default
// ui_* mappings plus the project's input map.
import { GdObject } from "./object.js";
import { Vector2, keycodeOf, GLOBALS } from "./values.js";

// default ui_* actions -> Godot keycodes
const K = (name) => GLOBALS[`KEY_${name}`];
const DEFAULT_ACTIONS = {
  ui_accept: [K("ENTER"), K("KP_ENTER"), K("SPACE")],
  ui_select: [K("SPACE")],
  ui_cancel: [K("ESCAPE")],
  ui_left: [K("LEFT")], ui_right: [K("RIGHT")], ui_up: [K("UP")], ui_down: [K("DOWN")],
  ui_focus_next: [K("TAB")],
  ui_page_up: [K("PAGEUP")], ui_page_down: [K("PAGEDOWN")], ui_home: [K("HOME")], ui_end: [K("END")],
};

export class InputEvent extends GdObject {
  static gdClass = "InputEvent";
  constructor() {
    super();
    this.pressed = false;
    this.device = 0;
  }
  is_pressed() { return !!this.pressed; }
  is_released() { return !this.pressed; }
  is_echo() { return false; }
  is_action(action) { return InputEvent.actions(action).some((m) => this.__matches(m)); }
  is_action_pressed(action, allowEcho = false) { return this.pressed && (allowEcho || !this.is_echo()) && this.is_action(action); }
  is_action_released(action) { return !this.pressed && this.is_action(action); }
  is_action_type() { return true; }
  duplicate() {
    const c = new this.constructor();
    for (const [k, v] of Object.entries(this)) if (!k.startsWith("__")) c[k] = v && v.duplicate ? v.duplicate() : v;
    return c;
  }
  __matches() { return false; }
  as_text() { return this.get_class(); }
  // the events (keycodes / mouse buttons) of an action: the project's input map, else the defaults
  static actions(action) {
    const fromProject = InputEvent.inputMap && InputEvent.inputMap[action];
    if (fromProject) return fromProject;
    return (DEFAULT_ACTIONS[action] || []).map((k) => ({ key: k }));
  }
}

export class InputEventWithModifiers extends InputEvent {
  static gdClass = "InputEventWithModifiers";
  constructor() {
    super();
    this.shift_pressed = this.ctrl_pressed = this.alt_pressed = this.meta_pressed = false;
  }
}

export class InputEventKey extends InputEventWithModifiers {
  static gdClass = "InputEventKey";
  constructor() {
    super();
    this.keycode = 0;
    this.physical_keycode = 0;
    this.unicode = 0;
    this.echo = false;
  }
  is_echo() { return !!this.echo; }
  get_keycode_with_modifiers() { return this.keycode; }
  __matches(m) { return m.key !== undefined && (m.key === this.keycode || m.key === this.physical_keycode); }
  as_text() { return String.fromCodePoint(this.unicode || 63); }
  /** From a browser KeyboardEvent (keydown -> pressed). */
  static fromKey(e, pressed = true) {
    const ev = new InputEventKey();
    ev.pressed = pressed;
    ev.keycode = ev.physical_keycode = keycodeOf(e);
    ev.unicode = e.key && e.key.length === 1 ? e.key.codePointAt(0) : 0;
    ev.echo = !!e.repeat;
    Object.assign(ev, { shift_pressed: !!e.shiftKey, ctrl_pressed: !!e.ctrlKey, alt_pressed: !!e.altKey, meta_pressed: !!e.metaKey });
    return ev;
  }
}

export class InputEventMouse extends InputEventWithModifiers {
  static gdClass = "InputEventMouse";
  constructor() {
    super();
    this.position = new Vector2();
    this.global_position = new Vector2();
    this.button_mask = 0;
  }
}

export class InputEventMouseButton extends InputEventMouse {
  static gdClass = "InputEventMouseButton";
  constructor() {
    super();
    this.button_index = 0;
    this.double_click = false;
    this.factor = 1;
  }
  __matches(m) { return m.mouse !== undefined && m.mouse === this.button_index; }
  /** From a screen point and a button (Godot's: 1 left, 2 right, 3 middle, 4/5 wheel). */
  static fromMouse(p, button, pressed, doubleClick = false) {
    const ev = new InputEventMouseButton();
    ev.position = new Vector2(p.x, p.y);
    ev.global_position = new Vector2(p.x, p.y);
    ev.button_index = button;
    ev.pressed = pressed;
    ev.double_click = doubleClick;
    return ev;
  }
}

export class InputEventMouseMotion extends InputEventMouse {
  static gdClass = "InputEventMouseMotion";
  constructor() {
    super();
    this.relative = new Vector2();
    this.velocity = new Vector2();
  }
  static fromMouse(p, last) {
    const ev = new InputEventMouseMotion();
    ev.position = new Vector2(p.x, p.y);
    ev.global_position = new Vector2(p.x, p.y);
    if (last) ev.relative = new Vector2(p.x - last.x, p.y - last.y);
    return ev;
  }
}

export class InputEventAction extends InputEvent {
  static gdClass = "InputEventAction";
  constructor() {
    super();
    this.action = "";
    this.strength = 1;
  }
  is_action(a) { return a === this.action; }
}

export const INPUT_CLASSES = { InputEvent, InputEventWithModifiers, InputEventKey, InputEventMouse, InputEventMouseButton, InputEventMouseMotion, InputEventAction };

/**
 * The project's input map (input/<action> settings: {events: [InputEventKey /
 * InputEventMouseButton sub-resources]}) as matchers.
 */
export function loadInputMap(settings) {
  const map = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (!k.startsWith("input/") || !v || !Array.isArray(v.events)) continue;
    map[k.slice(6)] = v.events
      .map((e) => {
        const p = (e && e.props) || {};
        if (e && e.type === "InputEventKey") return { key: p.keycode || p.physical_keycode || 0 };
        if (e && e.type === "InputEventMouseButton") return { mouse: p.button_index || 0 };
        return null;
      })
      .filter(Boolean);
  }
  InputEvent.inputMap = map;
  return map;
}
