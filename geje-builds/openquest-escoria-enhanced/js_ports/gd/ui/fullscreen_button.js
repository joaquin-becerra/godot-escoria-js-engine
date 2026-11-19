// Translated from res://ui/fullscreen_button.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const SIZE = 40.0;
  const MARGIN = 12.0;
  const COLOR = G.Color(0.886, 0.875, 0.863, 0.75);
  const COLOR_HOVER = G.Color(1, 1, 1, 1);
  const SHADOW = G.Color(0.094, 0.243, 0.408, 0.8);
  class fullscreen_button extends gd.base("CanvasLayer") {
    constructor(...args) {
      super(...args);
      this.__field("_button", null);
      this.__field("_hover", false);
    }
    _ready() {
      this.layer = 110;
      this.process_mode = G.PROCESS_MODE_ALWAYS;
      this._button = gd.new_("Control", []);
      this._button.size = G.Vector2(SIZE, SIZE);
      this._button.position = G.Vector2(op.sub(op.sub(gd.singleton("ProjectSettings").get_setting("display/window/size/viewport_width"), SIZE), MARGIN), MARGIN);
      this._button.mouse_default_cursor_shape = gd.member(gd.cls("Control"), "CURSOR_POINTING_HAND");
      call(gd.member(this._button, "draw"), "connect", gd.Callable(this, "_draw_icon"));
      call(gd.member(this._button, "gui_input"), "connect", gd.Callable(this, "_on_gui_input"));
      call(gd.member(this._button, "mouse_entered"), "connect", call(gd.Callable(this, "_set_hover"), "bind", true));
      call(gd.member(this._button, "mouse_exited"), "connect", call(gd.Callable(this, "_set_hover"), "bind", false));
      this.add_child(this._button);
      call(gd.member(this.get_window(), "size_changed"), "connect", gd.member(this._button, "queue_redraw"));
    }
    _set_hover(on) {
      this._hover = on;
      call(this._button, "queue_redraw");
    }
    _is_fullscreen() {
      let mode = gd.singleton("DisplayServer").window_get_mode();
      return (truthy(op.eq(mode, gd.member(gd.singleton("DisplayServer"), "WINDOW_MODE_FULLSCREEN"))) || truthy(op.eq(mode, gd.member(gd.singleton("DisplayServer"), "WINDOW_MODE_EXCLUSIVE_FULLSCREEN"))));
    }
    _on_gui_input(event) {
      if (truthy((truthy((truthy(gd.is(event, "InputEventMouseButton")) && truthy(gd.member(event, "pressed")))) && truthy(op.eq(gd.member(event, "button_index"), G.MOUSE_BUTTON_LEFT))))) {
        call(this._button, "accept_event");
        gd.cls("ESCProjectSettingsManager").set_setting(gd.member(gd.cls("ESCProjectSettingsManager"), "FULLSCREEN"), !truthy(this._is_fullscreen()));
        gd.member(gd.escoria, "settings_manager").apply_settings();
        gd.member(gd.escoria, "settings_manager").save_settings();
        call(this._button, "queue_redraw");
      }
    }
    _draw_icon() {
      let color = (truthy(this._hover) ? COLOR_HOVER : COLOR);
      let s = SIZE;
      let l = op.mul(s, 0.32);
      let w = 5.0;
      let inward = this._is_fullscreen();
      for (let shadow of iter([true, false])) {
        let off = (truthy(shadow) ? G.Vector2(2, 2) : gd.member(gd.cls("Vector2"), "ZERO"));
        let c = (truthy(shadow) ? SHADOW : color);
        for (let corner of iter([G.Vector2(0, 0), G.Vector2(1, 0), G.Vector2(0, 1), G.Vector2(1, 1)])) {
          let p = op.mul(corner, s);
          let dir = G.Vector2(op.sub(1, op.mul(2, gd.member(corner, "x"))), op.sub(1, op.mul(2, gd.member(corner, "y"))));
          if (truthy(inward)) {
            p = op.add(p, op.mul(dir, l));
            dir = op.neg(dir);
          }
          call(this._button, "draw_line", op.add(p, off), op.add(op.add(p, G.Vector2(op.mul(gd.member(dir, "x"), l), 0)), off), c, w);
          call(this._button, "draw_line", op.add(p, off), op.add(op.add(p, G.Vector2(0, op.mul(gd.member(dir, "y"), l))), off), c, w);
        }
      }
    }
  }
  Object.assign(fullscreen_button, { SIZE, MARGIN, COLOR, COLOR_HOVER, SHADOW });
  return fullscreen_button;
}
