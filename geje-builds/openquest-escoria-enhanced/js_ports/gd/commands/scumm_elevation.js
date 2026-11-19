// Translated from res://commands/scumm_elevation.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const SCALE = 4;
  class ScummElevationCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [2, [G.TYPE_STRING, G.TYPE_INT], [null, null]]);
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
      let node = gd.member(gd.member(gd.escoria, "object_manager").get_object(op.get(command_params, 0)), "node");
      let sprite = call(node, "get_node_or_null", "sprite");
      if (truthy((truthy(sprite) && truthy(call(gd.member(node, "custom_data"), "has", "scumm_base_offset_y"))))) {
        let y = op.sub(op.get(gd.member(node, "custom_data"), "scumm_base_offset_y"), op.mul(op.get(command_params, 1), SCALE));
        if (truthy(call(sprite, "has_meta", "hd_base"))) {
          let base = call(sprite, "get_meta", "hd_base");
          op.set(base, "offset", G.Vector2(gd.member(op.get(base, "offset"), "x"), y));
          call(gd.autoload("hd_graphics"), "_apply_animated_sprite", sprite);
        } else {
          ((__o) => { const __t = __o.offset; __t.y = y; if (gd.isValue(__t)) __o.offset = __t; return __t.y; })(sprite);
        }
      }
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  Object.assign(ScummElevationCommand, { SCALE });
  return ScummElevationCommand;
}
