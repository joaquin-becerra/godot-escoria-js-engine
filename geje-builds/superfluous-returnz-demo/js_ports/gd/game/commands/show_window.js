// Translated from res://game/commands/show_window.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const WINDOWS = "res://game/images/windows/";
  const FADE = 0.25;
  class show_window extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [1, [G.TYPE_STRING], [null]]);
    }
    validate(arguments_) {
      if (truthy(!truthy(super.validate?.(arguments_)))) {
        return false;
      }
      if (truthy(op.eq(gd.cls("SosageWindow").find_image(WINDOWS, op.get(arguments_, 0)), ""))) {
        this.raise_error(this, op.mod("Window image '%s' not found.", op.get(arguments_, 0)));
        return false;
      }
      return true;
    }
    async run(command_params) {
      let w = gd.new_("SosageWindow", []);
      gd.member(gd.escoria.get_tree(), "root").add_child(w);
      call(w, "open", G.load(gd.cls("SosageWindow").find_image(WINDOWS, op.get(command_params, 0))));
      (await gd.member(w, "closed"));
      call(w, "queue_free");
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  Object.assign(show_window, { WINDOWS, FADE });
  return show_window;
}
