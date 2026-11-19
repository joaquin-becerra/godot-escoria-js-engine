// Translated from res://game/commands/open_phone.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class open_phone extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [0, [], []]);
    }
    run(_command_params) {
      gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "game").call_deferred("pause_game");
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return open_phone;
}
