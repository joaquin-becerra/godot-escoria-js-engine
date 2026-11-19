// Translated from res://game/ui/sosage_say.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const FONT = gd.preload("res://game/fonts/TovariSans.ttf");
  const FONT_SIZE = 60;
  const OUTLINE_SIZE = 15;
  const SOSAGE_WIDTH_MAX = 960;
  const SOSAGE_CHAR_WIDTH = 18.75;
  const SOSAGE_MARGIN_X = 50;
  const SOSAGE_MIN_Y = 100;
  const SOSAGE_MIN_READING_TIME = 1.5;
  const SOSAGE_CHAR_SPOKEN_TIME = 0.05;
  class sosage_say extends gd.baseScript("res://addons/escoria-dialog-simple/types/floating.gd") {
    constructor(...args) {
      super(...args);
      this.__field("_say_id", 0);
      this.__field("_talking", null);
    }
    _ready() {
      super._ready?.();
      this.clip_contents = false;
      this.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      this.fit_content = true;
      this.scroll_active = false;
      this.autowrap_mode = gd.member(gd.cls("TextServer"), "AUTOWRAP_OFF");
      this.add_theme_font_override("normal_font", FONT);
      this.add_theme_font_size_override("normal_font_size", FONT_SIZE);
      this.add_theme_color_override("font_outline_color", gd.member(gd.cls("Color"), "BLACK"));
      this.add_theme_constant_override("outline_size", OUTLINE_SIZE);
      this.get_node("Timer").one_shot = true;
    }
    _process(_delta) {
      if (truthy((truthy(call(gd.member(this, "_current_character"), "is_inside_tree")) && truthy(G.is_instance_valid(gd.member(this, "dialog_location_node")))))) {
        this._place_above(gd.member(call(gd.member(this, "dialog_location_node"), "get_global_transform_with_canvas"), "origin"));
      }
    }
    _input(event) {
      if (truthy((truthy((truthy(!truthy(gd.member(this, "visible"))) || truthy(gd.member(this, "_text_timing_finished")))) || truthy(this.get_node("Timer").is_stopped())))) {
        return;
      }
      if (truthy((truthy((truthy((truthy(gd.is(event, "InputEventKey")) && truthy(gd.member(event, "pressed")))) && truthy(!truthy(gd.member(event, "echo"))))) && truthy(op.eq(gd.member(event, "physical_keycode"), G.KEY_SPACE))))) {
        call(this.get_viewport(), "set_input_as_handled");
        this._on_dialog_finished();
      }
    }
    say(character, line) {
      this._current_line = line;
      this._text_timing_finished = false;
      this._waiting_for_voice_audio = false;
      this.show();
      this._is_speeding_up = false;
      this._current_character = gd.member(gd.member(gd.escoria, "object_manager").get_object(character), "node");
      for (let c of iter(call(gd.member(this, "_current_character"), "get_children"))) {
        if (truthy(gd.is(c, "ESCDialogLocation"))) {
          this.dialog_location_node = c;
        }
      }
      let text_color_html = call(gd.member(gd.member(this, "_current_character"), "dialog_color"), "to_html", false);
      let lines = this._split_like_sosage(this.tr(line));
      gd.member(this, "text_node").text = op.add(op.add(op.add(op.add("[center][color=#", text_color_html), "]"), call("\n", "join", lines)), "[/color][/center]");
      gd.member(this, "size").x = this._measure_width(lines);
      if (truthy((truthy(call(gd.member(this, "_current_character"), "is_inside_tree")) && truthy(G.is_instance_valid(gd.member(this, "dialog_location_node")))))) {
        this._place_above(gd.member(call(gd.member(this, "dialog_location_node"), "get_global_transform_with_canvas"), "origin"));
      } else {
        this._place_above(G.Vector2(op.div(gd.singleton("ProjectSettings").get_setting("display/window/size/viewport_width"), 2.0), op.div(gd.singleton("ProjectSettings").get_setting("display/window/size/viewport_height"), 2.0)));
      }
      if (truthy((truthy(G.is_instance_valid(this._talking)) && truthy(op.ne(this._talking, gd.member(this, "_current_character")))))) {
        call(this._talking, "stop_talking");
      }
      this._talking = gd.member(this, "_current_character");
      call(gd.member(this, "_current_character"), "start_talking");
      this._say_id = op.add(this._say_id, 1);
      let this_say = this._say_id;
      let talking_character = gd.member(this, "_current_character");
      call(gd.member(call(this.get_tree(), "create_timer", op.mul(SOSAGE_CHAR_SPOKEN_TIME, G.len(gd.member(this, "_current_line")))), "timeout"), "connect", (() => {
      if (truthy((truthy(op.eq(this_say, this._say_id)) && truthy(G.is_instance_valid(talking_character))))) {
        call(talking_character, "stop_talking");
        this._talking = null;
      }
    }));
      gd.member(this, "text_node").visible_ratio = 1.0;
      call(gd.member(this, "tween"), "reset");
      call(gd.member(this, "tween"), "interpolate_property", gd.member(this, "text_node"), "visible_ratio", 1.0, 1.0, 0.0, gd.member(gd.cls("Tween"), "TRANS_LINEAR"), gd.member(gd.cls("Tween"), "EASE_IN_OUT"));
      call(gd.member(this, "tween"), "play");
      this.set_process(true);
    }
    _on_dialog_line_typed(_object, _key) {
      gd.member(this, "text_node").visible_characters = -1;
      this._waiting_for_voice_audio = false;
      this.get_node("Timer").start(this._calculate_time_to_disappear());
      if (truthy(!truthy(call(gd.member(this.get_node("Timer"), "timeout"), "is_connected", gd.member(this, "_on_dialog_finished"))))) {
        call(gd.member(this.get_node("Timer"), "timeout"), "connect", gd.member(this, "_on_dialog_finished"));
      }
      call(gd.member(this, "say_visible"), "emit");
    }
    _calculate_time_to_disappear() {
      let speed = gd.member(gd.escoria, "settings_manager").get_custom_setting("text_speed", 1.0);
      return op.mul((op.add(SOSAGE_MIN_READING_TIME, op.mul(SOSAGE_CHAR_SPOKEN_TIME, G.len(gd.member(this, "_current_line"))))), speed);
    }
    _split_like_sosage(line) {
      let estimated = op.mul(SOSAGE_CHAR_WIDTH, call(line, "length"));
      if (truthy((estimated < SOSAGE_WIDTH_MAX))) {
        return G.PackedStringArray([line]);
      }
      let nb = op.add(1, G.int(op.div(estimated, SOSAGE_WIDTH_MAX)));
      let result = G.PackedStringArray();
      let begin = 0;
      for (let i of iter(G.range(1, nb))) {
        let cut = G.int(op.mul(i, (op.div(call(line, "length"), G.float(nb)))));
        let before = cut;
        while (truthy((truthy((before > begin)) && truthy(op.ne(op.get(line, before), " "))))) {
          before = op.sub(before, 1);
        }
        let after = cut;
        while (truthy((truthy((after < call(line, "length"))) && truthy(op.ne(op.get(line, after), " "))))) {
          after = op.add(after, 1);
        }
        let best = before;
        if (truthy((truthy(op.ne(op.get(line, before), " ")) || truthy(((truthy((after < call(line, "length"))) && truthy((op.sub(after, cut) < op.sub(cut, before))))))))) {
          best = after;
        }
        if (truthy((truthy((best <= begin)) || truthy((best >= call(line, "length")))))) {
          continue;
        }
        call(result, "append", call(line, "substr", begin, op.sub(best, begin)));
        begin = op.add(best, 1);
      }
      call(result, "append", call(line, "substr", begin));
      return result;
    }
    _measure_width(lines) {
      let width = 0.0;
      for (let l of iter(lines)) {
        width = G.max(width, gd.member(call(FONT, "get_string_size", l, G.HORIZONTAL_ALIGNMENT_LEFT, -1, FONT_SIZE), "x"));
      }
      return op.add(op.add(G.ceil(width), op.mul(2, OUTLINE_SIZE)), 8);
    }
    _place_above(label) {
      gd.member(this, "position").x = op.sub(gd.member(label, "x"), op.div(gd.member(gd.member(this, "size"), "x"), 2));
      gd.member(this, "position").y = G.max(op.sub(gd.member(label, "y"), gd.member(gd.member(this, "size"), "y")), SOSAGE_MIN_Y);
      this._account_for_margin_x();
      this._account_for_margin_y();
    }
    _account_for_margin_x() {
      if (truthy((gd.member(gd.member(this, "position"), "x") < SOSAGE_MARGIN_X))) {
        gd.member(this, "position").x = SOSAGE_MARGIN_X;
      }
      let screen_margin_x = op.sub(op.add(op.add(gd.member(gd.member(this, "position"), "x"), gd.member(gd.member(this, "size"), "x")), SOSAGE_MARGIN_X), gd.singleton("ProjectSettings").get("display/window/size/viewport_width"));
      if (truthy((screen_margin_x > 0))) {
        gd.member(this, "position").x = op.sub(gd.member(this, "position").x, screen_margin_x);
      }
    }
  }
  Object.assign(sosage_say, { FONT, FONT_SIZE, OUTLINE_SIZE, SOSAGE_WIDTH_MAX, SOSAGE_CHAR_WIDTH, SOSAGE_MARGIN_X, SOSAGE_MIN_Y, SOSAGE_MIN_READING_TIME, SOSAGE_CHAR_SPOKEN_TIME });
  return sosage_say;
}
