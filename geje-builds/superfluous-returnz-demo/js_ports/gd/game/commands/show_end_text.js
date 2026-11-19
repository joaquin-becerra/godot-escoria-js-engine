// Translated from res://game/commands/show_end_text.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const FONT = gd.preload("res://game/fonts/PTN77F.ttf");
  class show_end_text extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [1, [G.TYPE_STRING], [null]]);
    }
    async run(command_params) {
      let layer = gd.new_("CanvasLayer", []);
      layer.layer = 30;
      let root = gd.new_("ColorRect", []);
      root.color = gd.member(gd.cls("Color"), "BLACK");
      root.size = G.Vector2(1920, 1080);
      root.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_STOP");
      call(layer, "add_child", root);
      let label = gd.new_("Label", []);
      label.text = call(this.tr(op.get(command_params, 0)), "replace", "\\n", "\n");
      call(label, "add_theme_font_override", "font", FONT);
      call(label, "add_theme_font_size_override", "font_size", 50);
      label.horizontal_alignment = G.HORIZONTAL_ALIGNMENT_CENTER;
      label.vertical_alignment = G.VERTICAL_ALIGNMENT_CENTER;
      label.size = gd.member(root, "size");
      call(root, "add_child", label);
      gd.member(gd.escoria.get_tree(), "root").add_child(layer);
      ((__o) => { const __t = __o.modulate; __t.a = 0.0; if (gd.isValue(__t)) __o.modulate = __t; return __t.a; })(root);
      gd.escoria.get_tree().create_tween().tween_property(root, "modulate:a", 1.0, 0.5);
      while (truthy(true)) {
        let event = (await gd.member(root, "gui_input"));
        if (truthy((truthy(gd.is(event, "InputEventMouseButton")) && truthy(gd.member(event, "pressed"))))) {
          break;
        }
      }
      call(layer, "queue_free");
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  Object.assign(show_end_text, { FONT });
  return show_end_text;
}
