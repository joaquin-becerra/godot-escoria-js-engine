// Translated from res://commands/scumm_sound.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class ScummSoundCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [1, [G.TYPE_STRING], [null]]);
    }
    run(command_params) {
      let player = gd.new_("AudioStreamPlayer", []);
      player.stream = G.load(op.get(command_params, 0));
      player.bus = "SFX";
      gd.escoria.add_child(player);
      call(gd.member(player, "finished"), "connect", gd.member(player, "queue_free"));
      call(player, "play");
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return ScummSoundCommand;
}
