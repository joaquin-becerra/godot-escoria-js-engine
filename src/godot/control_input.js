// Mouse and keyboard for the Controls of the scene trees (a room's Controls,
// the scenes spawn() adds): hover, Buttons (pressed, toggled, button_down /
// button_up), CheckBox, OptionButton (its list: item_selected), sliders
// (dragging, the wheel: value_changed, drag_started / drag_ended), the wheel
// on a ScrollContainer, and typing in LineEdit / TextEdit (text_changed,
// text_submitted). A Control that catches the mouse (mouse_filter STOP)
// keeps the click from reaching the room.
//
// `trees()` gives the trees to look in, topmost first: [{root, base}] with
// `base` the transform from the tree to the screen. `emit(node, signal, args)`
// tells the scripts (the GDScript bridge).
import { controlsAt } from "./render.js";
import { ui, INTERACTIVE, optionItems, openPopup, popupItemAt, scrollBy, setRangeValue, sliderValueAt } from "./controls.js";
import { apply, invert } from "./render.js";

const SLIDERS = new Set(["HSlider", "VSlider"]);
// Control.CursorShape -> css cursor
// Control types whose default_cursor_shape isn't ARROW
const DEFAULT_CURSOR = { LineEdit: 1, TextEdit: 1 };
const CURSORS = ["", "text", "pointer", "crosshair", "wait", "progress", "grab", "grabbing", "not-allowed", "ns-resize", "ew-resize", "nesw-resize", "nwse-resize", "move", "col-resize", "row-resize", "help"];

export class ControlInput {
  constructor(trees, emit) {
    this.trees = trees;
    this.emit = emit;
    this.caretTime = 0;
  }

  /** The topmost control under p (screen) that catches the mouse: {node, local, xf}, or null. */
  hitEntry(p) {
    if (!p) return null;
    for (const { root, base, onlyInteractive } of this.trees()) {
      if (!root || root.props.visible === false) continue;
      const list = controlsAt(root, base, p).filter((c) => !onlyInteractive || INTERACTIVE.has(c.node.type));
      if (list.length) return list[0];
    }
    return null;
  }

  /** The topmost control under p, or null. An open OptionButton list covers everything. */
  hit(p) {
    if (ui.popup) return ui.popup.node;
    const e = this.hitEntry(p);
    return e ? e.node : null;
  }

  /** Mouse moved: hover, dragging a slider. True if the mouse is over a control (the room shouldn't show its tooltip). */
  move(p) {
    if (ui.popup) {
      const i = popupItemAt(p);
      ui.popup.hover = i ?? -1;
      return true;
    }
    if (ui.drag && p) {
      this.slide(ui.drag, apply(invert(ui.dragXf), p));
      return true;
    }
    const e = this.hitEntry(p);
    const n = e && e.node;
    ui.hover = n && INTERACTIVE.has(n.type) && n.type !== "ScrollContainer" ? n : null;
    // mouse_entered / mouse_exited, and the cursor of the control under the mouse
    if (n !== this.over) {
      if (this.over) this.emit(this.over, "mouse_exited", []);
      if (n) this.emit(n, "mouse_entered", []);
      this.over = n;
    }
    this.cursor = n ? CURSORS[n.props.mouse_default_cursor_shape ?? DEFAULT_CURSOR[n.type] ?? 0] || "" : "";
    if (n && p) this.emit(n, "gui_input", [{ kind: "mouse_motion", x: e.local.x, y: e.local.y, gx: p.x, gy: p.y }]);
    return !!n;
  }

  slide(n, local) {
    if (setRangeValue(n, sliderValueAt(n, local))) this.emit(n, "value_changed", [n.props.value]);
  }

  /** Mouse button down: true if a control took it. */
  down(p, button = 0) {
    if (ui.popup) {
      // a click on an item selects it; anywhere else closes the list
      const n = ui.popup.node;
      const i = popupItemAt(p);
      ui.popup = null;
      if (i !== null && i >= 0) this.select(n, i);
      return true;
    }
    const e = this.hitEntry(p);
    const n = e && e.node;
    if (!n) {
      ui.focus = null;
      return false;
    }
    // every control under the mouse gets gui_input (Godot button index: 1 left, 2 right, 3 middle)
    this.emit(n, "gui_input", [{ kind: "mouse_button", button: [1, 3, 2][button] ?? 1, pressed: true, x: e.local.x, y: e.local.y, gx: p.x, gy: p.y }]);
    if (button !== 0 || n.props.disabled) return true;
    if (n.type === "OptionButton") {
      ui.focus = null;
      if (optionItems(n).length) {
        this.emit(n, "about_to_popup", []); // its list's signal (get_popup()): scripts style it here
        openPopup(n, e.xf);
      }
      return true;
    }
    if (SLIDERS.has(n.type)) {
      ui.focus = null;
      if (n.props.editable === false) return true;
      ui.drag = n;
      ui.dragXf = e.xf;
      this.emit(n, "drag_started", []);
      this.slide(n, e.local);
      return true;
    }
    if (n.type === "LineEdit" || n.type === "TextEdit") {
      if (n.props.editable !== false) ui.focus = n;
      return true;
    }
    ui.focus = null;
    if (n.type === "Button" || n.type === "CheckBox" || n.type === "TextureButton") {
      ui.down = n;
      this.emit(n, "button_down", []);
      if (n.props.action_mode === 0) this.press(n);
    }
    return true;
  }

  /** Mouse button up: a button held down and still under the mouse is pressed. */
  up(p, button = 0) {
    const e = this.hitEntry(p);
    if (e) this.emit(e.node, "gui_input", [{ kind: "mouse_button", button: [1, 3, 2][button] ?? 1, pressed: false, x: e.local.x, y: e.local.y, gx: p.x, gy: p.y }]);
    if (ui.drag) {
      const d = ui.drag;
      ui.drag = null;
      this.emit(d, "drag_ended", [true]);
      return true;
    }
    const n = ui.down;
    if (!n) return false;
    ui.down = null;
    this.emit(n, "button_up", []);
    if (n.props.action_mode !== 0 && this.hit(p) === n && !n.props.disabled) this.press(n);
    return true;
  }

  /** OptionButton: select item i (as a click on the list does). */
  select(n, i) {
    const it = optionItems(n)[i];
    if (!it || it.disabled) return;
    n.props.selected = i;
    // Godot emits item_selected even when it was already selected
    this.emit(n, "item_selected", [i]);
  }

  /**
   * The wheel (dy > 0 down): a slider under the mouse moves a step, else the
   * nearest ScrollContainer scrolls. True if a control used it.
   */
  wheel(p, dy) {
    if (ui.popup) return true;
    const n = this.hit(p);
    if (!n) return false;
    for (let x = n; x; x = x.parent) {
      if (SLIDERS.has(x.type) && x.props.editable !== false && x.props.scrollable !== false) {
        const step = x.props.step || ((x.props.max_value ?? 100) - (x.props.min_value ?? 0)) / 16;
        if (setRangeValue(x, (x.props.value ?? 0) + (dy < 0 ? step : -step))) this.emit(x, "value_changed", [x.props.value]);
        return true;
      }
      if (x.type === "ScrollContainer") {
        scrollBy(x, 0, dy > 0 ? 40 : -40);
        return true;
      }
    }
    return true;
  }

  press(n) {
    if (n.props.toggle_mode || n.type === "CheckBox") {
      n.props.button_pressed = !n.props.button_pressed;
      this.emit(n, "toggled", [n.props.button_pressed]);
    }
    this.emit(n, "pressed", []);
  }

  /** A key: typing in the focused LineEdit / TextEdit. True if it was used. */
  key(e) {
    if (ui.popup) {
      // the open list: arrows move, Enter selects, Escape closes
      const pp = ui.popup, items = optionItems(pp.node);
      if (e.key === "Escape") ui.popup = null;
      else if (e.key === "ArrowDown") pp.hover = Math.min(items.length - 1, pp.hover + 1);
      else if (e.key === "ArrowUp") pp.hover = Math.max(0, pp.hover - 1);
      else if (e.key === "Enter" && pp.hover >= 0) {
        ui.popup = null;
        this.select(pp.node, pp.hover);
      }
      return true;
    }
    const n = ui.focus;
    if (!n) return false;
    if (!this.inTree(n)) {
      ui.focus = null;
      return false;
    }
    let t = String(n.props.text ?? "");
    const max = n.props.max_length || 0;
    if (e.key === "Escape") {
      ui.focus = null;
      return true;
    }
    if (e.key === "Enter") {
      if (n.type === "TextEdit") t += "\n";
      else {
        this.emit(n, "text_submitted", [t]);
        return true;
      }
    } else if (e.key === "Backspace") t = t.slice(0, -1);
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      if (max && t.length >= max) return true;
      t += e.key;
    } else return e.key !== "Tab"; // other keys stay with the control, but Tab
    if (t === n.props.text) return true;
    n.props.text = t;
    this.emit(n, "text_changed", n.type === "TextEdit" ? [] : [t]);
    return true;
  }

  // is the node still in one of the trees, all its ancestors visible?
  inTree(n) {
    const roots = this.trees().map((t) => t.root).filter(Boolean);
    if (n && n.parent === null && roots.includes(n)) return n.props.visible !== false;
    for (let x = n; x; x = x.parent) {
      if (x.props.visible === false) return false;
      if (roots.includes(x)) return true;
    }
    return false;
  }

  /** Blinks the caret. */
  update(dt) {
    this.caretTime += dt;
    ui.caret = Math.floor(this.caretTime * 2) % 2 === 0;
    if (ui.hover && !this.inTree(ui.hover)) ui.hover = null;
    if (ui.focus && !this.inTree(ui.focus)) ui.focus = null;
    if (ui.popup && !this.inTree(ui.popup.node)) ui.popup = null;
    if (ui.drag && !this.inTree(ui.drag)) ui.drag = null;
  }
}
