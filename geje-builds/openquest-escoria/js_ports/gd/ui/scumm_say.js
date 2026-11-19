// Translated from res://ui/scumm_say.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const SCREEN_WIDTH = 1280;
  const SIDE_MARGIN = 320;
  const CHAR_INC = 4;
  const GAME_FPS = 30.0;
  class scumm_say extends gd.baseScript("res://addons/escoria-dialog-simple/types/floating.gd") {
    constructor(...args) {
      super(...args);
    }
    _ready() {
      super._ready?.();
      this.fit_content = true;
      this.autowrap_mode = gd.member(gd.cls("TextServer"), "AUTOWRAP_WORD_SMART");
      this.scroll_active = false;
      this.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
    }
    say(character, line) {
      super.say?.(character, line);
      this._scumm_layout();
    }
    _scumm_layout() {
      if (truthy(!truthy(G.is_instance_valid(gd.member(this, "dialog_location_node"))))) {
        return;
      }
      let x = this._center_x();
      let max_width = op.mul(2.0, G.minf(x, op.sub(SCREEN_WIDTH, x)));
      let font = this.get_theme_font("normal_font");
      let font_size = this.get_theme_font_size("normal_font_size");
      let width = gd.member(call(font, "get_string_size", this.get_parsed_text(), G.HORIZONTAL_ALIGNMENT_LEFT, -1, font_size), "x");
      this.size = G.Vector2(G.minf(op.add(width, 2), max_width), 0);
      gd.member(this, "position").x = op.sub(x, op.div(gd.member(gd.member(this, "size"), "x"), 2));
      gd.member(this, "position").y = G.maxf(gd.member(gd.member(this, "position"), "y"), 0.0);
    }
    _center_x() {
      let origin = gd.member(call(gd.member(this, "dialog_location_node"), "get_global_transform_with_canvas"), "origin");
      return G.clampf(gd.member(origin, "x"), SIDE_MARGIN, op.sub(SCREEN_WIDTH, SIDE_MARGIN));
    }
    _process(delta) {
      super._process?.(delta);
      if (truthy(G.is_instance_valid(gd.member(this, "dialog_location_node")))) {
        gd.member(this, "position").x = op.sub(this._center_x(), op.div(gd.member(gd.member(this, "size"), "x"), 2));
      }
    }
    _calculate_time_to_disappear() {
      return op.div(op.mul(G.len(gd.member(this, "_current_line")), CHAR_INC), GAME_FPS);
    }
  }
  Object.assign(scumm_say, { SCREEN_WIDTH, SIDE_MARGIN, CHAR_INC, GAME_FPS });
  return scumm_say;
}
