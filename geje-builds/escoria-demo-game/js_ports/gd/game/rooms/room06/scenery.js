// Translated from res://game/rooms/room06/scenery.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const CLOUDX_RESET = 1320;
  const CLOUDX_MIN = 585;
  const CLOUDX_SPEED = 55;
  const WAVE_SPEED = 3;
  const WAVE_HEIGHT = 30;
  const WAVE_LENGTH = 60;
  class scenery extends gd.base("Node") {
    constructor(...args) {
      super(...args);
      this.__field("wave_counter", 0);
      this.__field("cloud_1x", CLOUDX_RESET);
      this.__field("cloud_1y", null);
      this.__field("cloud_2x", op.add(CLOUDX_RESET, 180));
      this.__field("cloud_2y", null);
    }
    _ready() {
      G.randomize();
      this.cloud_1y = op.add(op.mod(G.randi(), 175), 60);
      this.cloud_2y = op.add(op.mod(G.randi(), 175), 60);
    }
    animate_cloud(delta) {
      this.cloud_1x = op.sub(this.cloud_1x, op.mul(CLOUDX_SPEED, delta));
      if (truthy((this.cloud_1x < CLOUDX_MIN))) {
        this.cloud_1x = CLOUDX_RESET;
        this.cloud_1y = op.add(op.mod(G.randi(), 175), 60);
      }
      this.get_node("cloud").set_position(G.Vector2(this.cloud_1x, this.cloud_1y));
      this.cloud_2x = op.sub(this.cloud_2x, op.mul(CLOUDX_SPEED, delta));
      if (truthy((this.cloud_2x < CLOUDX_MIN))) {
        this.cloud_2x = CLOUDX_RESET;
        this.cloud_2y = op.add(op.mod(G.randi(), 175), 60);
      }
      this.get_node("cloud2").set_position(G.Vector2(this.cloud_2x, this.cloud_2y));
    }
    animate_waves(delta) {
      this.wave_counter = op.add(this.wave_counter, delta);
      let c1_xlocation = op.add(520, (op.mul(G.sin(op.add(1.6, op.mul(this.wave_counter, WAVE_SPEED))), WAVE_LENGTH)));
      let c1_ylocation = op.add(560, (op.mul(G.cos(op.add(1.6, op.mul(this.wave_counter, WAVE_SPEED))), WAVE_HEIGHT)));
      this.get_node("wave").set_position(G.Vector2(c1_xlocation, c1_ylocation));
      let c2_xlocation = op.add(620, (op.mul(G.sin(op.add(0.8, op.mul(this.wave_counter, WAVE_SPEED))), WAVE_LENGTH)));
      let c2_ylocation = op.add(530, (op.mul(G.cos(op.add(0.8, op.mul(this.wave_counter, WAVE_SPEED))), WAVE_HEIGHT)));
      this.get_node("wave2").set_position(G.Vector2(c2_xlocation, c2_ylocation));
      let c3_xlocation = op.add(720, (op.mul(G.sin(op.mul(this.wave_counter, WAVE_SPEED)), WAVE_LENGTH)));
      let c3_ylocation = op.add(500, (op.mul(G.cos(op.mul(this.wave_counter, WAVE_SPEED)), WAVE_HEIGHT)));
      this.get_node("wave3").set_position(G.Vector2(c3_xlocation, c3_ylocation));
    }
    _process(delta) {
      this.animate_waves(delta);
      this.animate_cloud(delta);
    }
  }
  Object.assign(scenery, { CLOUDX_RESET, CLOUDX_MIN, CLOUDX_SPEED, WAVE_SPEED, WAVE_HEIGHT, WAVE_LENGTH });
  return scenery;
}
