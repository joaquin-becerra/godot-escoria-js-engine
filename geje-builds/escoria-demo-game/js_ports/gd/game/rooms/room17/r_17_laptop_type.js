// Translated from res://game/rooms/room17/r_17_laptop_type.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class r_17_laptop_type extends gd.base("Control") {
    constructor(...args) {
      super(...args);
      this.__field("say_command", null);
      this.__field("acceptinput_command", null);
    }
    __onready() {
      this.say_command = gd.new_("SayCommand", []);
      this.acceptinput_command = gd.new_("AcceptInputCommand", []);
    }
    _ready() {
      call(this.acceptinput_command, "run", ["NONE"]);
    }
    _on_cancel_button_pressed() {
      call(this.acceptinput_command, "run", ["ALL"]);
      gd.escoria.current_state = gd.member(gd.member(gd.escoria, "GameState"), "DEFAULT");
      this.queue_free();
    }
    _on_ok_button_pressed() {
      let text = gd.member(this.get_node("Panel/LineEdit"), "text");
      this.queue_free();
      call(this.say_command, "run", ["player", gd.member(this.get_node("Panel/LineEdit"), "text"), "floating", ""]);
      call(this.acceptinput_command, "run", ["ALL"]);
      gd.escoria.current_state = gd.member(gd.member(gd.escoria, "GameState"), "DEFAULT");
    }
  }
  return r_17_laptop_type;
}
