// Translated from res://game/ui/sosage_chooser.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const FONT = gd.preload("res://game/fonts/TovariSans.ttf");
  const WORLD = G.Vector2(1920, 1080);
  const FONT_SIZE = 60;
  const MARGIN = 10;
  class sosage_chooser extends gd.baseScript("res://addons/escoria-dialog-simple/chooser/simple.gd") {
    constructor(...args) {
      super(...args);
      this.__field("_background", null);
      this.__field("_choices", null);
    }
    _ready() {
      this.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      this._background = gd.new_("ColorRect", []);
      this._background.color = G.Color(0, 0, 0, 0.752941);
      this._background.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      this.add_child(this._background);
      this._choices = gd.new_("VBoxContainer", []);
      this._choices.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      call(this._choices, "add_theme_constant_override", "separation", 0);
      this.add_child(this._choices);
      this.get_node("Timer").one_shot = true;
      super._ready?.();
    }
    _process(_delta) {

    }
    show_chooser() {
      for (let c of iter(call(this._choices, "get_children"))) {
        call(this._choices, "remove_child", c);
        call(c, "queue_free");
      }
      let hover = G.Color("5FD38D");
      let player = (truthy(gd.member(gd.member(gd.escoria, "main"), "current_scene")) ? gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "player") : null);
      if (truthy((truthy(player) && truthy(op.in("dialog_color", player))))) {
        hover = gd.member(player, "dialog_color");
      }
      for (let option of iter(gd.member(gd.member(this, "dialog"), "options"))) {
        if (truthy(!truthy(call(option, "is_valid")))) {
          continue;
        }
        let b = gd.new_("Button", []);
        b.text = this.tr(gd.member((option), "option"));
        b.flat = true;
        b.alignment = G.HORIZONTAL_ALIGNMENT_LEFT;
        b.focus_mode = gd.member(gd.cls("Control"), "FOCUS_NONE");
        call(b, "add_theme_font_override", "font", FONT);
        call(b, "add_theme_font_size_override", "font_size", FONT_SIZE);
        for (let state of iter(["font_color", "font_focus_color", "font_pressed_color"])) {
          call(b, "add_theme_color_override", state, gd.member(gd.cls("Color"), "WHITE"));
        }
        call(b, "add_theme_color_override", "font_hover_color", hover);
        call(b, "add_theme_color_override", "font_hover_pressed_color", hover);
        let empty = gd.new_("StyleBoxEmpty", []);
        for (let style of iter(["normal", "hover", "pressed", "focus"])) {
          call(b, "add_theme_stylebox_override", style, empty);
        }
        let w = gd.member(call(FONT, "get_string_size", gd.member(b, "text"), G.HORIZONTAL_ALIGNMENT_LEFT, -1, FONT_SIZE), "x");
        if (truthy((w > op.sub(gd.member(WORLD, "x"), op.mul(2, MARGIN))))) {
          call(b, "add_theme_font_size_override", "font_size", G.int(op.div(op.mul(FONT_SIZE, (op.sub(gd.member(WORLD, "x"), op.mul(2, MARGIN)))), w)));
        }
        call(this._choices, "add_child", b);
        call(gd.member(b, "pressed"), "connect", call(gd.member(this, "_on_answer_selected"), "bind", option));
      }
      if (truthy(op.eq(call(this._choices, "get_child_count"), 0))) {
        this._no_more_options = true;
        this.get_node("Timer").start(0.05);
        return;
      }
      call(this._choices, "reset_size");
      let h = gd.member(call(this._choices, "get_combined_minimum_size"), "y");
      this._choices.position = G.Vector2(MARGIN, op.sub(op.sub(gd.member(WORLD, "y"), MARGIN), h));
      this._background.position = G.Vector2(0, op.sub(op.sub(gd.member(WORLD, "y"), h), op.mul(2, MARGIN)));
      this._background.size = G.Vector2(gd.member(WORLD, "x"), op.add(h, op.mul(2, MARGIN)));
      call(this._background, "show");
      call(this._choices, "show");
      if (truthy((truthy((gd.member(gd.member(this, "dialog"), "timeout") > 0)) && truthy(call(gd.member(this, "dialog"), "get_timeout_option"))))) {
        this.get_node("Timer").start(gd.member(gd.member(this, "dialog"), "timeout"));
      }
    }
    hide_chooser() {
      super.hide_chooser?.();
      if (truthy(this._choices)) {
        call(this._choices, "hide");
        call(this._background, "hide");
      }
    }
    _option_chosen(option) {
      this.hide_chooser();
      super._option_chosen?.(option);
    }
  }
  Object.assign(sosage_chooser, { FONT, WORLD, FONT_SIZE, MARGIN });
  return sosage_chooser;
}
