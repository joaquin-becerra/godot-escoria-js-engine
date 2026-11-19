// Translated from res://game/rooms/no_escoria/player.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const next_scene_path = "res://game/rooms/room01/room01.tscn";
  class player extends gd.base("Area2D") {
    constructor(...args) {
      super(...args);
      this.__field("speed", this.__export("speed", 400));
      this.__field("screen_size", null);
      this.__field("_change_scene", null);
    }
    __onready() {
      this._change_scene = gd.new_("ChangeSceneCommand", []);
    }
    _ready() {
      this.screen_size = gd.member(this.get_viewport_rect(), "size");
    }
    _process(delta) {
      let velocity = gd.member(gd.cls("Vector2"), "ZERO");
      if (truthy(gd.singleton("Input").is_action_pressed("ui_right"))) {
        velocity.x = op.add(velocity.x, 1);
      }
      if (truthy(gd.singleton("Input").is_action_pressed("ui_left"))) {
        velocity.x = op.sub(velocity.x, 1);
      }
      if (truthy(gd.singleton("Input").is_action_pressed("ui_down"))) {
        velocity.y = op.add(velocity.y, 1);
      }
      if (truthy(gd.singleton("Input").is_action_pressed("ui_up"))) {
        velocity.y = op.sub(velocity.y, 1);
      }
      if (truthy((call(velocity, "length") > 0))) {
        velocity = op.mul(call(velocity, "normalized"), this.speed);
      }
      this.position = op.add(this.position, op.mul(velocity, delta));
      this.position = call(gd.member(this, "position"), "clamp", gd.member(gd.cls("Vector2"), "ZERO"), this.screen_size);
      if (truthy((gd.member(gd.member(this, "position"), "x") > 800))) {
        call(this._change_scene, "run", [next_scene_path, false]);
        this.queue_free();
      }
    }
  }
  Object.assign(player, { next_scene_path });
  return player;
}
