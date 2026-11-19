// Translated from res://commands/scumm_restore_names.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class ScummRestoreNamesCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [0, [], []]);
    }
    run(_command_params) {
      let globals = gd.member(gd.escoria, "globals_manager").get_globals();
      for (let key of iter(globals)) {
        if (truthy(call(G.str(key), "begins_with", gd.member(gd.cls("ScummSetNameCommand"), "PREFIX")))) {
          gd.cls("ScummSetNameCommand").apply(call(G.str(key), "substr", call(gd.member(gd.cls("ScummSetNameCommand"), "PREFIX"), "length")), G.str(op.get(globals, key)));
        }
      }
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return ScummRestoreNamesCommand;
}
