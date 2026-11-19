// Translated from res://game/commands/crouch.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class crouch extends gd.base("ESCBaseCommand") {
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
      let item = gd.member(gd.member(gd.escoria, "object_manager").get_object(op.get(command_params, 0)), "node");
      let path = gd.member(gd.member(item, "animations"), "resource_path");
      let standing = call(path, "replace", "_crouch_animations.tres", "_animations.tres");
      let crouched = call(standing, "replace", "_animations.tres", "_crouch_animations.tres");
      let target = (truthy(op.get(command_params, 1)) ? crouched : standing);
      if (truthy((truthy(op.ne(target, path)) && truthy(gd.singleton("ResourceLoader").exists(target))))) {
        item.animations = G.load(target);
      }
      call(item, "update_idle");
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return crouch;
}
