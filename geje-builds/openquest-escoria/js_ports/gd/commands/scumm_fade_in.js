// Translated from res://commands/scumm_fade_in.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class ScummFadeInCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [0, [], []]);
    }
    run(command_params) {
      call(gd.cls("ScummScreen").get_screen(), "fade_in");
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return ScummFadeInCommand;
}
