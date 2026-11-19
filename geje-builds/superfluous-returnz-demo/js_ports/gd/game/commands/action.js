// Translated from res://game/commands/action.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class action extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [1, [G.TYPE_STRING, [G.TYPE_INT, G.TYPE_FLOAT], G.TYPE_STRING], [null, 0.2, "action"]]);
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
    async run(command_params) {
      let item = gd.member(gd.member(gd.escoria, "object_manager").get_object(op.get(command_params, 0)), "node");
      if (truthy(op.eq(op.get(command_params, 2), "idle"))) {
        call(item, "update_idle");
        return gd.member(gd.cls("ESCExecution"), "RC_OK");
      }
      let player = call(item, "get_animation_player");
      let idle = gd.member(op.get(gd.member(gd.member(item, "animations"), "idles"), gd.member(gd.member(item, "_movable"), "last_dir")), "animation");
      let pose = call(idle, "replace", "idle", op.get(command_params, 2));
      if (truthy(call(player, "has_animation", pose))) {
        call(player, "play", pose);
      }
      if (truthy((G.float(op.get(command_params, 1)) < 0))) {
        return gd.member(gd.cls("ESCExecution"), "RC_OK");
      }
      (await gd.member(gd.escoria.get_tree().create_timer(G.float(op.get(command_params, 1))), "timeout"));
      call(item, "update_idle");
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return action;
}
