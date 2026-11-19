// Translated from res://game/commands/show_code.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const WINDOWS = "res://game/images/windows/";
  const CODES = { "safe": { "images": { "": "coffre_fort", "ashes": "coffre_fort_cendre" }, "button_sound": "bip1", "success_sound": "succes1", "failure_sound": "echec", "buttons": [[0, 260, 672, 225, 200], [1, 25, 475, 225, 200], [2, 260, 475, 225, 200], [3, 500, 475, 225, 200], [4, 25, 250, 225, 200], [5, 260, 250, 225, 200], [6, 500, 250, 225, 200], [7, 25, 30, 225, 200], [8, 260, 30, 225, 200], [9, 500, 30, 225, 200]], "answer": [1, 9, 8, 9] }, "gnu_bust": { "images": { "": "buste_gnu" }, "cursor": "res://game/images/inventory/coton_tige.png", "button_sound": "gnou", "success_sound": "gnou_succes", "failure_sound": "gnou_echec", "buttons": [[1, 71, 423, 104, 98], [2, 181, 423, 104, 98], [3, 412, 423, 104, 98], [4, 518, 423, 104, 98]], "answer": [1, 4, 2, 2] } };
  class show_code extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [2, [G.TYPE_STRING, G.TYPE_STRING, G.TYPE_STRING], [null, null, ""]]);
    }
    validate(arguments_) {
      if (truthy(!truthy(super.validate?.(arguments_)))) {
        return false;
      }
      if (truthy(!truthy(call(CODES, "has", op.get(arguments_, 0))))) {
        this.raise_error(this, op.mod("Unknown code '%s'.", op.get(arguments_, 0)));
        return false;
      }
      if (truthy(!truthy(call(op.get(op.get(CODES, op.get(arguments_, 0)), "images"), "has", op.get(arguments_, 2))))) {
        this.raise_error(this, op.mod("Unknown variant '%s' for code '%s'.", [op.get(arguments_, 2), op.get(arguments_, 0)]));
        return false;
      }
      return true;
    }
    async run(command_params) {
      let code = op.get(CODES, op.get(command_params, 0));
      let base = op.get(op.get(code, "images"), op.get(command_params, 2));
      let w = gd.new_("SosageWindow", []);
      gd.member(gd.escoria.get_tree(), "root").add_child(w);
      call(w, "open_code", G.load(op.add(op.add(WINDOWS, base), "_off.png")), G.load(op.add(op.add(WINDOWS, base), "_on.png")), code);
      (await gd.member(w, "closed"));
      gd.member(gd.escoria, "globals_manager").set_global(op.get(command_params, 1), gd.member(w, "success"));
      call(w, "queue_free");
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  Object.assign(show_code, { WINDOWS, CODES });
  return show_code;
}
