// Translated from res://game/commands/face.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class face extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [2, [G.TYPE_STRING, G.TYPE_STRING], [null, null]]);
    }
    validate(arguments_) {
      if (truthy(!truthy(super.validate?.(arguments_)))) {
        return false;
      }
      for (let id of iter(arguments_)) {
        if (truthy(!truthy(gd.member(gd.escoria, "object_manager").has(id)))) {
          this.raise_invalid_object_error(this, id);
          return false;
        }
      }
      return true;
    }
    run(command_params) {
      let item = gd.member(gd.member(gd.escoria, "object_manager").get_object(op.get(command_params, 0)), "node");
      let target = gd.member(gd.member(gd.escoria, "object_manager").get_object(op.get(command_params, 1)), "node");
      let dx = op.sub(gd.member(gd.member(target, "global_position"), "x"), gd.member(gd.member(item, "global_position"), "x"));
      if (truthy(op.eq(dx, 0.0))) {
        return gd.member(gd.cls("ESCExecution"), "RC_OK");
      }
      let angle = (truthy((dx > 0.0)) ? 90 : 270);
      call(item, "set_angle", G.wrapi(op.sub(angle, 90), 0, 360));
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return face;
}
