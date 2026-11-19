// Translated from res://ui/scumm_dialog_chooser.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const LINE_X = 48;
  const LINE_Y = 580;
  const LINE_STEP = 44;
  const MAX_LINES = 5;
  const FONT = "res://fonts/charset_3.fnt";
  const FONT_SIZE = 40;
  const ARROW_FONT = "res://fonts/charset_2.fnt";
  const ARROW_FONT_SIZE = 64;
  const ARROWS = [[8, 580, "\u0003"], [8, 756, "\u0002"]];
  const COLOR_NORMAL = G.Color(0.6667, 0.1176, 0.0392, 1);
  const COLOR_HOVER = G.Color(1.0, 0.0, 0.0, 1);
  class scumm_dialog_chooser extends gd.baseScript("res://addons/escoria-dialog-simple/chooser/simple.gd") {
    constructor(...args) {
      super(...args);
      this.__field("_lines", null);
      this.__field("_options", []);
      this.__field("_offset", 0);
    }
    _ready() {
      super._ready?.();
      this._lines = gd.new_("Control", []);
      this._lines.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      this.add_child(this._lines);
      call(this._lines, "hide");
    }
    show_chooser() {
      this._options = [];
      for (let option of iter(gd.member(gd.member(this, "dialog"), "options"))) {
        if (truthy(call(option, "is_valid"))) {
          call(this._options, "append", option);
        }
      }
      if (truthy(call(this._options, "is_empty"))) {
        this._no_more_options = true;
        this.get_node("Timer").start(0.05);
        return;
      }
      this._offset = 0;
      this._build();
      call(this._lines, "show");
    }
    hide_chooser() {
      super.hide_chooser?.();
      if (truthy(this._lines)) {
        call(this._lines, "hide");
      }
    }
    _button(text, pos, font_path, font_size) {
      let b = gd.new_("Button", []);
      b.text = text;
      b.flat = true;
      b.focus_mode = gd.member(gd.cls("Control"), "FOCUS_NONE");
      b.alignment = G.HORIZONTAL_ALIGNMENT_LEFT;
      b.position = pos;
      for (let style of iter(["normal", "hover", "pressed", "hover_pressed", "focus"])) {
        call(b, "add_theme_stylebox_override", style, gd.new_("StyleBoxEmpty", []));
      }
      if (truthy(op.ne(font_path, ""))) {
        call(b, "add_theme_font_override", "font", G.load(font_path));
        call(b, "add_theme_font_size_override", "font_size", font_size);
      }
      call(b, "add_theme_color_override", "font_color", COLOR_NORMAL);
      for (let c of iter(["font_hover_color", "font_pressed_color", "font_hover_pressed_color"])) {
        call(b, "add_theme_color_override", c, COLOR_HOVER);
      }
      call(this._lines, "add_child", b);
      return b;
    }
    _build() {
      for (let c of iter(call(this._lines, "get_children"))) {
        call(c, "queue_free");
      }
      let shown = call(this._options, "slice", this._offset, op.add(this._offset, MAX_LINES));
      for (let i of iter(call(shown, "size"))) {
        let b = this._button(gd.member(op.get(shown, i), "option"), G.Vector2(LINE_X, op.add(LINE_Y, op.mul(LINE_STEP, i))), FONT, FONT_SIZE);
        call(gd.member(b, "pressed"), "connect", call(gd.member(this, "_on_answer_selected"), "bind", op.get(shown, i)));
      }
      if (truthy(op.eq(call(ARROWS, "size"), 2))) {
        if (truthy((this._offset > 0))) {
          call(gd.member(this._button(op.get(op.get(ARROWS, 0), 2), G.Vector2(op.get(op.get(ARROWS, 0), 0), op.get(op.get(ARROWS, 0), 1)), ARROW_FONT, ARROW_FONT_SIZE), "pressed"), "connect", call(gd.Callable(this, "_scroll"), "bind", -1));
        }
        if (truthy((op.add(this._offset, MAX_LINES) < call(this._options, "size")))) {
          call(gd.member(this._button(op.get(op.get(ARROWS, 1), 2), G.Vector2(op.get(op.get(ARROWS, 1), 0), op.get(op.get(ARROWS, 1), 1)), ARROW_FONT, ARROW_FONT_SIZE), "pressed"), "connect", call(gd.Callable(this, "_scroll"), "bind", 1));
        }
      }
    }
    _scroll(direction) {
      this._offset = G.clampi(op.add(this._offset, op.mul(direction, (op.div(MAX_LINES, 2)))), 0, G.maxi(op.sub(call(this._options, "size"), MAX_LINES), 0));
      this._build();
    }
  }
  Object.assign(scumm_dialog_chooser, { LINE_X, LINE_Y, LINE_STEP, MAX_LINES, FONT, FONT_SIZE, ARROW_FONT, ARROW_FONT_SIZE, ARROWS, COLOR_NORMAL, COLOR_HOVER });
  return scumm_dialog_chooser;
}
