// Translated from res://game/rooms/room03/room03.tscn::15 by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class room03_tscn_15 extends gd.base("Node2D") {
    constructor(...args) {
      super(...args);
    }
    enable_door(_notused) {
      this.get_node("../CollisionPolygon2D").disabled = false;
    }
    disable_door(_notused) {
      this.get_node("../CollisionPolygon2D").disabled = true;
    }
  }
  return room03_tscn_15;
}
