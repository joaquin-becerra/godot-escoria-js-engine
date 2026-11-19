// Translated from res://commands/scumm_fade_out.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class ScummFadeOutCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [0, [G.TYPE_BOOL], [false]]);
    }
    async run(command_params) {
      (await call(gd.cls("ScummScreen").get_screen(), "fade_out", op.get(command_params, 0)));
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return ScummFadeOutCommand;
}
