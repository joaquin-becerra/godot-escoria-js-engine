// Translated from res://game/commands/show_item.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class show_item extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [2, [G.TYPE_STRING, G.TYPE_BOOL], [null, null]]);
    }
    validate(arguments_) {
      if (truthy(!truthy(super.validate?.(arguments_)))) {
        return false;
      }
      if (truthy(!truthy(gd.member(gd.escoria, "object_manager").has(op.get(arguments_, 0))))) {
        this.raise_invalid_object_error(this, op.get(arguments_, 0));
        return false;
      }
      return true;
    }
    run(command_params) {
      ((__o) => { const __t = __o.node; __t.visible = op.get(command_params, 1); if (gd.isValue(__t)) __o.node = __t; return __t.visible; })(gd.member(gd.escoria, "object_manager").get_object(op.get(command_params, 0)));
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return show_item;
}
