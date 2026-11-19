// Translated from res://ui/scumm_say.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const SCREEN_WIDTH = 1280;
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
      let x = gd.member(gd.member(call(gd.member(this, "dialog_location_node"), "get_global_transform_with_canvas"), "origin"), "x");
      let max_width = op.mul(2.0, G.clampf(G.minf(x, op.sub(SCREEN_WIDTH, x)), 1.0, op.div(SCREEN_WIDTH, 2.0)));
      let font = this.get_theme_font("normal_font");
      let font_size = this.get_theme_font_size("normal_font_size");
      let width = gd.member(call(font, "get_string_size", this.get_parsed_text(), G.HORIZONTAL_ALIGNMENT_LEFT, -1, font_size), "x");
      this.size = G.Vector2(G.minf(op.add(width, 2), max_width), 0);
      gd.member(this, "position").x = op.sub(x, op.div(gd.member(gd.member(this, "size"), "x"), 2));
    }
    _calculate_time_to_disappear() {
      return op.div(op.mul(G.len(gd.member(this, "_current_line")), CHAR_INC), GAME_FPS);
    }
    _on_dialog_line_typed(_object, _key) {
      let cut = this._should_stop_talking_when_text_finishes();
      super._on_dialog_line_typed?.(_object, _key);
      if (truthy((truthy(cut) && truthy(G.is_instance_valid(gd.member(this, "_current_character")))))) {
        call(gd.member(this, "_current_character"), "start_talking");
      }
    }
    _on_dialog_finished() {
      this._stop_character_talking();
      super._on_dialog_finished?.();
    }
  }
  Object.assign(scumm_say, { SCREEN_WIDTH, CHAR_INC, GAME_FPS });
  return scumm_say;
}
