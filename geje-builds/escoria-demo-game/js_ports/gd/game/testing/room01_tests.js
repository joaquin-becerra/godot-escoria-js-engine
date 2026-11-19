// Translated from res://game/testing/room01_tests.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const SOURCE = "${source_resource_path}";
  class Room01Test extends gd.base("GdUnitTestSuite") {
    constructor(...args) {
      super(...args);
      this.__field("_change_scene_cmd", null);
    }
    __onready() {
      this._change_scene_cmd = gd.new_("ChangeSceneCommand", []);
    }
    async test_simulate_frames(_timeout = 15000) {
      call(this._change_scene_cmd, "run", ["res://game/rooms/room01/room01.tscn", false]);
      let runner = this.scene_runner(gd.member(gd.member(gd.escoria, "main"), "current_scene"));
      let room_scene = call(runner, "scene");
      let player_object = gd.member(room_scene, "player");
      let target_pos1 = call(room_scene, "get_node", "orients_down_on_arrival");
      let target_pos2 = call(room_scene, "get_node", "set_angle_by_esc");
      (await call(runner, "simulate_frames", 300));
      call(this.assert_object(call(gd.member(player_object, "position"), "round")), "is_equal", call(gd.member(target_pos1, "position"), "round"));
      (await call(runner, "simulate_frames", 300));
      call(this.assert_object(call(gd.member(player_object, "position"), "round")), "is_equal", call(gd.member(target_pos2, "position"), "round"));
      (await call(runner, "simulate_frames", 700));
      call(this.assert_object(call(gd.member(player_object, "position"), "round")), "is_equal", call(gd.member(target_pos1, "position"), "round"));
    }
  }
  Object.assign(Room01Test, { SOURCE });
  return Room01Test;
}
