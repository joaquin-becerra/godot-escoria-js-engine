// Translated from res://commands/scumm_quit.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class ScummQuitCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [0, [], []]);
    }
    run(_command_params) {
      gd.escoria.quit();
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return ScummQuitCommand;
}
