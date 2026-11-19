// Translated from res://commands/scumm_roam.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class ScummRoamCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [2, [G.TYPE_STRING, G.TYPE_STRING, G.TYPE_INT, G.TYPE_INT, G.TYPE_INT, G.TYPE_INT], [null, null, 0, 0, 0, 0]]);
    }
    run(command_params) {
      call(gd.cls("ScummRoaming").get_node_instance(), "control", op.get(command_params, 0), op.get(command_params, 1), call(command_params, "slice", 2));
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return ScummRoamCommand;
}
