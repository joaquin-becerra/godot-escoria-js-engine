// Translated from res://game/commands/shake.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class shake extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [2, [[G.TYPE_INT, G.TYPE_FLOAT], [G.TYPE_INT, G.TYPE_FLOAT]], [null, null]]);
    }
    run(command_params) {
      let camera = gd.escoria.get_viewport().get_camera_2d();
      if (truthy(op.eq(camera, null))) {
        return gd.member(gd.cls("ESCExecution"), "RC_OK");
      }
      let intensity = G.float(op.get(command_params, 0));
      let duration = G.float(op.get(command_params, 1));
      let t = gd.escoria.get_tree().create_tween();
      let steps = G.int(op.div(duration, 0.05));
      for (let i of iter(steps)) {
        let a = op.mul(intensity, (op.sub(1.0, op.div(G.float(i), steps))));
        call(t, "tween_property", camera, "offset:x", (truthy(op.eq(op.mod(i, 2), 0)) ? a : op.neg(a)), 0.05);
      }
      call(t, "tween_property", camera, "offset:x", 0.0, 0.05);
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  return shake;
}
