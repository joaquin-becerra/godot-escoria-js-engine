// Translated from res://game/rooms/room08/puzzle/10_buttons_puzzle.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class _10_buttons_puzzle extends gd.base("Panel") {
    constructor(...args) {
      super(...args);
      this.__field("numbers_array", []);
      this.__field("next_to_be_pressed", 1);
    }
    _ready() {
      G.randomize();
      this.initialize();
      this.reset();
      for (let button of iter(this.get_node("GridContainer").get_children())) {
        call(button, "connect", "pressed", call(gd.Callable(this, "_button_pressed"), "bind", button));
      }
      gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "game").hide_ui();
      gd.member(gd.member(gd.escoria, "main"), "current_scene").hide();
    }
    initialize() {
      this.numbers_array = G.range(1, 11);
      call(this.numbers_array, "shuffle");
    }
    reset() {
      this.get_node("win_label").hide();
      this.next_to_be_pressed = 1;
      let i = 0;
      for (let button of iter(this.get_node("GridContainer").get_children())) {
        let number = op.get(this.numbers_array, i);
        button.text = G.str(number);
        button.button_pressed = false;
        button.disabled = false;
        i = op.add(i, 1);
      }
    }
    _button_pressed(button) {
      let number = gd.member(button, "text");
      if (truthy(op.ne(G.int(number), this.next_to_be_pressed))) {
        this.reset();
      } else {
        button.disabled = true;
        this.next_to_be_pressed = op.add(this.next_to_be_pressed, 1);
      }
      if (truthy(op.eq(this.next_to_be_pressed, 11))) {
        this.win();
      }
    }
    async win() {
      this.get_node("win_label").show();
      (await gd.member(call(this.get_tree(), "create_timer", 2), "timeout"));
      this.hide();
      gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "game").show_ui();
      gd.member(gd.member(gd.escoria, "main"), "current_scene").show();
      gd.member(gd.escoria, "globals_manager").set_global("r8_m_door_open", true);
      gd.member(gd.escoria, "object_manager").get_object("r8_m_door").set_state("door_open");
      gd.member(gd.escoria, "object_manager").get_object("r8_mini_puzzle_button").active = false;
    }
    _on_quit_pressed() {
      gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "game").show_ui();
      gd.member(gd.member(gd.escoria, "main"), "current_scene").show();
      this.queue_free();
    }
  }
  return _10_buttons_puzzle;
}
