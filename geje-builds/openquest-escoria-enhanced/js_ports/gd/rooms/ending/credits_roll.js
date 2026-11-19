// Translated from res://rooms/ending/credits_roll.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const LINES = [["logo", ""], ["gap", ""], ["title", "CREDITS_GAME"], ["name", "Michael Sheail"], ["gap", ""], ["title", "CREDITS_AGS"], ["name", "Chris Jones"], ["gap", ""], ["title", "CREDITS_SCUMMC"], ["name", "Jennifer McMurray"], ["gap", ""], ["title", "CREDITS_GODOT"], ["name", "Joaquin A. Becerra"], ["gap", ""]];
  const SPEED = 45.0;
  const TOP = 0.0;
  const BOTTOM = 576.0;
  const COLOR_TITLE = G.Color(0.749, 0.741, 0.376);
  const COLOR_NAME = G.Color(0.886, 0.886, 0.886);
  const COLOR_OUTLINE = G.Color(0.094, 0.243, 0.408);
  class credits_roll extends gd.base("Control") {
    constructor(...args) {
      super(...args);
      this.__field("_started", false);
      this.__field("_finished", false);
      this.__field("_roll", null);
      this.__field("_thanks", null);
    }
    __onready() {
      this._roll = this.get_node("roll");
      this._thanks = this.get_node("thanks");
    }
    _ready() {
      for (let line of iter(LINES)) {
        call(this._roll, "add_child", this._make(op.get(line, 0), op.get(line, 1)));
      }
      ((__o) => { const __t = __o.position; __t.y = BOTTOM; if (gd.isValue(__t)) __o.position = __t; return __t.y; })(this._roll);
      ((__o) => { const __t = __o.modulate; __t.a = 0.0; if (gd.isValue(__t)) __o.modulate = __t; return __t.a; })(this._thanks);
    }
    _make(style, text) {
      {
        const __m1 = style;
        if (op.eq(__m1, "logo")) {
          let logo = gd.new_("TextureRect", []);
          logo.texture = G.load("res://rooms/title_screen/title_logo.png");
          logo.stretch_mode = gd.member(gd.cls("TextureRect"), "STRETCH_KEEP_CENTERED");
          return logo;
        }
        else if (op.eq(__m1, "gap")) {
          let gap = gd.new_("Control", []);
          gap.custom_minimum_size = G.Vector2(0, 40);
          return gap;
        }
      }
      let label = gd.new_("Label", []);
      label.text = text;
      label.horizontal_alignment = G.HORIZONTAL_ALIGNMENT_CENTER;
      label.autowrap_mode = gd.member(gd.cls("TextServer"), "AUTOWRAP_WORD_SMART");
      label.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      if (truthy(op.eq(style, "name"))) {
        label.auto_translate_mode = gd.member(gd.cls("Node"), "AUTO_TRANSLATE_MODE_DISABLED");
      }
      let font_path = (truthy(op.eq(style, "title")) ? "res://fonts/verb_chset.fnt" : "res://fonts/dialog_charset.fnt");
      call(label, "add_theme_font_override", "font", G.load(font_path));
      call(label, "add_theme_font_size_override", "font_size", 40);
      call(label, "add_theme_color_override", "font_color", (truthy(op.eq(style, "title")) ? COLOR_TITLE : COLOR_NAME));
      call(label, "add_theme_color_override", "font_outline_color", COLOR_OUTLINE);
      call(label, "add_theme_constant_override", "outline_size", 8);
      call(label, "add_theme_color_override", "font_shadow_color", COLOR_OUTLINE);
      call(label, "add_theme_constant_override", "shadow_offset_x", 4);
      call(label, "add_theme_constant_override", "shadow_offset_y", 4);
      return label;
    }
    _process(delta) {
      if (truthy(!truthy(this._started))) {
        if (truthy(op.eq(gd.member(gd.escoria, "globals_manager").get_global("credits_start"), 1))) {
          this._started = true;
        }
        return;
      }
      if (truthy(this._finished)) {
        return;
      }
      ((__o) => { const __t = __o.position; __t.y = op.sub(__t.y, op.mul(SPEED, delta)); if (gd.isValue(__t)) __o.position = __t; return __t.y; })(this._roll);
      if (truthy((op.add(gd.member(gd.member(this._roll, "position"), "y"), gd.member(gd.member(this._roll, "size"), "y")) < TOP))) {
        this._finished = true;
        call(this.create_tween(), "tween_property", this._thanks, "modulate:a", 1.0, 1.5);
      }
    }
    _input(event) {
      if (truthy(!truthy(this._started))) {
        return;
      }
      let click = (truthy(gd.is(event, "InputEventMouseButton")) && truthy(gd.member(event, "pressed")));
      let key = (truthy((truthy(gd.is(event, "InputEventKey")) && truthy(gd.member(event, "pressed")))) && truthy(!truthy(gd.member(event, "echo"))));
      if (truthy(!truthy(((truthy(click) || truthy(key)))))) {
        return;
      }
      call(this.get_viewport(), "set_input_as_handled");
      if (truthy(this._finished)) {
        gd.escoria.quit();
      } else {
        ((__o) => { const __t = __o.position; __t.y = op.sub(TOP, gd.member(gd.member(this._roll, "size"), "y")); if (gd.isValue(__t)) __o.position = __t; return __t.y; })(this._roll);
      }
    }
  }
  Object.assign(credits_roll, { LINES, SPEED, TOP, BOTTOM, COLOR_TITLE, COLOR_NAME, COLOR_OUTLINE });
  return credits_roll;
}
