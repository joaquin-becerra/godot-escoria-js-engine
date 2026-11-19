// Translated from res://commands/scumm_state_var.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class ScummStateVarCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [2, [G.TYPE_STRING, G.TYPE_INT], [null, null]]);
    }
    run(command_params) {
      gd.member(gd.escoria, "globals_manager").set_global(op.add(op.get(command_params, 0), "_state"), op.get(command_params, 1), true);
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return ScummStateVarCommand;
}
