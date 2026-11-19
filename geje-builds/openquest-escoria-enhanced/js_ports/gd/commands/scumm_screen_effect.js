// Translated from res://commands/scumm_screen_effect.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class ScummScreenEffectCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [1, [G.TYPE_INT], [null]]);
    }
    run(command_params) {
      gd.member(gd.escoria, "globals_manager").set_global(gd.member(gd.cls("ScummScreen"), "GLOBAL"), op.get(command_params, 0), true);
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return ScummScreenEffectCommand;
}
