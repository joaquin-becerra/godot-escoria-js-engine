// Translated from res://rooms/title_screen/title_characters.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const ZIF_SCENE = "res://characters/commander_zif/commander_zif.tscn";
  const ZOB_SCENE = "res://characters/ensign_zob/ensign_zob.tscn";
  const ZIF_POS = G.Vector2(888, 208);
  const ZOB_POS = G.Vector2(1028, 208);
  const LISTENING = 0;
  const WAITING = 1;
  const PASSING = 2;
  class title_characters extends gd.base("Node2D") {
    constructor(...args) {
      super(...args);
      this.__field("_zif", null);
      this.__field("_zob", null);
      this.__field("_state", LISTENING);
    }
    async _ready() {
      this._zif = this._make_sprite(ZIF_SCENE, ZIF_POS, "stand_with_phone_down");
      this._zob = this._make_sprite(ZOB_SCENE, ZOB_POS, "idle_down");
      this._zif_loop();
      this._zob_loop();
      this.set_process_input(false);
      (await gd.member(this.get_tree(), "process_frame"));
      this.set_process_input(true);
    }
    async _input(event) {
      if (truthy((truthy(op.eq(this._state, PASSING)) || truthy(!truthy(gd.is(event, "InputEventMouseButton")))))) {
        return;
      }
      if (truthy(op.eq(this._state, WAITING))) {
        call(this.get_viewport(), "set_input_as_handled");
        return;
      }
      if (truthy(!truthy(((truthy(gd.member(event, "pressed")) && truthy(op.eq(gd.member(event, "button_index"), G.MOUSE_BUTTON_LEFT))))))) {
        return;
      }
      call(this.get_viewport(), "set_input_as_handled");
      this._state = WAITING;
      gd.cls("LoadingSpinner").start();
      (await gd.member(gd.singleton("RenderingServer"), "frame_post_draw"));
      (await gd.member(gd.singleton("RenderingServer"), "frame_post_draw"));
      this._state = PASSING;
      gd.singleton("Input").parse_input_event(event);
      let release = call(event, "duplicate");
      release.pressed = false;
      gd.singleton("Input").parse_input_event(release);
    }
    _make_sprite(scene_path, pos, anim) {
      let actor = call(G.load(scene_path), "instantiate");
      let src = call(actor, "get_node", "sprite");
      let sprite = gd.new_("AnimatedSprite2D", []);
      sprite.sprite_frames = gd.member(src, "sprite_frames");
      sprite.centered = gd.member(src, "centered");
      sprite.offset = gd.member(src, "offset");
      sprite.position = pos;
      call(actor, "free");
      this.add_child(sprite);
      call(sprite, "play", anim);
      return sprite;
    }
    async _wait(min_s, max_s) {
      let timer = gd.new_("Timer", []);
      timer.one_shot = true;
      this.add_child(timer);
      call(timer, "start", G.randf_range(min_s, max_s));
      (await gd.member(timer, "timeout"));
      call(timer, "queue_free");
    }
    async _zif_loop() {
      while (truthy(true)) {
        call(this._zif, "play", "talk_to_phone_start_down");
        (await this._wait(1.2, 3.0));
        call(this._zif, "play", "stand_with_phone_down");
        (await this._wait(0.6, 1.8));
      }
    }
    async _zob_loop() {
      (await this._wait(0.5, 1.5));
      while (truthy(true)) {
        for (let i of iter(G.randi_range(1, 3))) {
          call(this._zob, "play", "scan_down");
          (await gd.member(this._zob, "animation_finished"));
          (await this._wait(0.2, 0.6));
        }
        call(this._zob, "play", "idle_down");
        (await this._wait(1.5, 3.5));
      }
    }
  }
  Object.assign(title_characters, { ZIF_SCENE, ZOB_SCENE, ZIF_POS, ZOB_POS, LISTENING, WAITING, PASSING });
  return title_characters;
}
