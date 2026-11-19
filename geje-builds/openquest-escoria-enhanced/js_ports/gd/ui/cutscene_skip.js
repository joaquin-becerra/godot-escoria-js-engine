// Translated from res://ui/cutscene_skip.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const SPEED = 20.0;
  class cutscene_skip extends gd.base("Node") {
    constructor(...args) {
      super(...args);
      this.__field("_room", null);
    }
    _ready() {
      this.process_mode = G.PROCESS_MODE_ALWAYS;
      this.set_process(false);
    }
    try_skip() {
      if (truthy(op.ne(gd.member(gd.member(gd.escoria, "inputs_manager"), "input_mode"), gd.member(gd.member(gd.escoria, "inputs_manager"), "INPUT_SKIP")))) {
        return false;
      }
      if (truthy(!truthy(this.is_processing()))) {
        this._room = gd.member(gd.member(gd.escoria, "main"), "current_scene");
        gd.singleton("Engine").time_scale = SPEED;
        gd.singleton("AudioServer").set_bus_mute(0, true);
        this.set_process(true);
      }
      return true;
    }
    _process(_delta) {
      if (truthy((truthy(op.ne(gd.member(gd.member(gd.escoria, "inputs_manager"), "input_mode"), gd.member(gd.member(gd.escoria, "inputs_manager"), "INPUT_SKIP"))) || truthy(op.ne(gd.member(gd.member(gd.escoria, "main"), "current_scene"), this._room))))) {
        gd.singleton("Engine").time_scale = 1.0;
        gd.singleton("AudioServer").set_bus_mute(0, false);
        this.set_process(false);
      }
    }
  }
  Object.assign(cutscene_skip, { SPEED });
  return cutscene_skip;
}
