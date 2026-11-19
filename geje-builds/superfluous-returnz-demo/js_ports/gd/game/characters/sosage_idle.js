// Translated from res://game/characters/sosage_idle.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const FPS = 12.0;
  const TRANSITION = 0;
  const DEFAULT_POSE = 1;
  const CLOSED_EYES = 0;
  class sosage_idle extends gd.base("Node") {
    constructor(...args) {
      super(...args);
      this.__field("body_poses", this.__export("body_poses", G.PackedInt32Array([1, 2, 3, 4])));
      this.__field("_player", null);
      this.__field("_body", null);
      this.__field("_head", null);
      this.__field("_anim", "");
      this.__field("_row", 0);
      this.__field("_body_pose", DEFAULT_POSE);
      this.__field("_body_left", 0.0);
      this.__field("_in_transition", false);
      this.__field("_head_pose", 1);
      this.__field("_head_left", 0.0);
      this.__field("_blink_left", 0.0);
      this.__field("_blinking", false);
    }
    __onready() {
      this._player = call(this.get_parent(), "get_node", "AnimationPlayer");
      this._body = call(this.get_parent(), "get_node", "body");
      this._head = call(this.get_parent(), "get_node", "body/head");
    }
    _process(delta) {
      let anim = "";
      if (truthy(call(this._player, "is_playing"))) {
        anim = gd.member(this._player, "current_animation");
      }
      if (truthy((truthy(op.ne(anim, "idle_left")) && truthy(op.ne(anim, "idle_right"))))) {
        this._anim = "";
        return;
      }
      if (truthy(op.ne(anim, this._anim))) {
        this._start(anim);
      }
      this._tick_body(delta);
      this._tick_head(delta);
    }
    _frames(n_min, n_max) {
      return op.div(G.randi_range(n_min, op.sub(n_max, 1)), FPS);
    }
    _start(anim) {
      this._anim = anim;
      this._row = (truthy(op.eq(anim, "idle_left")) ? 1 : 0);
      this._body_pose = DEFAULT_POSE;
      this._in_transition = false;
      this._body_left = this._frames(50, 500);
      this._head_pose = 1;
      this._head_left = this._frames(30, 300);
      this._blinking = false;
      this._blink_left = this._frames(5, 50);
      this._show();
    }
    _tick_body(delta) {
      this._body_left = op.sub(this._body_left, delta);
      if (truthy((this._body_left > 0.0))) {
        return;
      }
      if (truthy(this._in_transition)) {
        this._in_transition = false;
        this._body_left = this._frames(50, 500);
      } else {
        this._in_transition = true;
        this._body_left = op.div(2.0, FPS);
        let next = this._body_pose;
        while (truthy((truthy(op.eq(next, this._body_pose)) && truthy((call(this.body_poses, "size") > 1))))) {
          next = op.get(this.body_poses, G.randi_range(0, op.sub(call(this.body_poses, "size"), 1)));
        }
        this._body_pose = next;
      }
      this._show();
    }
    _tick_head(delta) {
      if (truthy(this._blinking)) {
        this._blink_left = op.sub(this._blink_left, delta);
        if (truthy((this._blink_left <= 0.0))) {
          this._blinking = false;
          this._blink_left = this._frames(5, 50);
          this._show();
        }
        return;
      }
      this._blink_left = op.sub(this._blink_left, delta);
      this._head_left = op.sub(this._head_left, delta);
      if (truthy((this._head_left <= 0.0))) {
        if (truthy((truthy(op.eq(G.randi_range(0, 3), 0)) && truthy((gd.member(this._head, "hframes") > 2))))) {
          let next = this._head_pose;
          while (truthy(op.eq(next, this._head_pose))) {
            next = G.randi_range(1, op.sub(gd.member(this._head, "hframes"), 1));
          }
          this._head_pose = next;
        }
        this._head_left = this._frames(30, 300);
        this._blink_left = this._frames(5, 50);
        this._show();
      } else if (truthy((this._blink_left <= 0.0))) {
        this._blinking = true;
        this._blink_left = op.div(1.0, FPS);
        this._show();
      }
    }
    _show() {
      let body_col = (truthy(this._in_transition) ? TRANSITION : this._body_pose);
      this._body.frame = op.add(op.mul(this._row, gd.member(this._body, "hframes")), body_col);
      let head_col = (truthy(this._blinking) ? CLOSED_EYES : this._head_pose);
      this._head.frame = op.add(op.mul(this._row, gd.member(this._head, "hframes")), head_col);
    }
  }
  Object.assign(sosage_idle, { FPS, TRANSITION, DEFAULT_POSE, CLOSED_EYES });
  return sosage_idle;
}
