// Translated from res://commands/scumm_anim.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const DIRECTIONS = ["up", "right", "down", "left"];
  class ScummAnimCommand extends gd.base("ESCBaseCommand") {
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
      if (truthy(!truthy(gd.member(gd.escoria, "object_manager").has(op.get(arguments_, 0))))) {
        this.raise_invalid_object_error(this, op.get(arguments_, 0));
        return false;
      }
      return true;
    }
    run(command_params) {
      let node = gd.member(gd.member(gd.escoria, "object_manager").get_object(op.get(command_params, 0)), "node");
      let animator = call(node, "get_animation_player");
      let dir = 2;
      if (truthy(gd.member(node, "_movable"))) {
        dir = G.clampi(gd.member(gd.member(node, "_movable"), "last_dir"), 0, op.sub(call(DIRECTIONS, "size"), 1));
      }
      let candidates = [op.get(DIRECTIONS, dir)];
      if (truthy(op.eq(op.get(DIRECTIONS, dir), "left"))) {
        call(candidates, "append", "right");
      }
      call(candidates, "append_array", ["down", "right", "up", "left"]);
      for (let d of iter(candidates)) {
        let anim_name = op.mod("%s_%s", [op.get(command_params, 1), d]);
        if (truthy(call(animator, "has_animation", anim_name))) {
          call(animator, "play", anim_name);
          return gd.member(gd.cls("ESCExecution"), "RC_OK");
        }
      }
      gd.member(gd.escoria, "logger").warn(this, op.mod("No animation %s for %s", [op.get(command_params, 1), op.get(command_params, 0)]));
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  Object.assign(ScummAnimCommand, { DIRECTIONS });
  return ScummAnimCommand;
}
