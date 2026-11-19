// Translated from res://commands/debug_final.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class DebugFinalCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [0, [], []]);
    }
    run(_command_params) {
      let script = gd.member(gd.escoria, "esc_compiler").load_esc_file("res://items/inventory/inv_gun.esc");
      gd.member(gd.escoria, "event_manager").queue_event(call(script, "get_event_with_target", "give", "commander_zif"));
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return DebugFinalCommand;
}
