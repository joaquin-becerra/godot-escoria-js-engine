// Translated from res://commands/scumm_room_intensity.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const LAYER_NAME = "ScummPalette";
  const SHADER = "\nshader_type canvas_item;\nrender_mode blend_mul;\nuniform vec3 scale = vec3(1.0);\nvoid fragment() {\n\tCOLOR = vec4(scale, 1.0);\n}\n";
  class ScummRoomIntensityCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [3, [G.TYPE_INT, G.TYPE_INT, G.TYPE_INT], [null, null, null]]);
    }
    run(command_params) {
      let room = gd.member(gd.member(gd.escoria, "main"), "current_scene");
      let layer = call(room, "get_node_or_null", LAYER_NAME);
      let scale = op.div(G.Vector3(op.get(command_params, 0), op.get(command_params, 1), op.get(command_params, 2)), 255.0);
      if (truthy((truthy((truthy((gd.member(scale, "x") >= 1.0)) && truthy((gd.member(scale, "y") >= 1.0)))) && truthy((gd.member(scale, "z") >= 1.0))))) {
        if (truthy(layer)) {
          call(layer, "queue_free");
        }
        return gd.member(gd.cls("ESCExecution"), "RC_OK");
      }
      if (truthy(op.eq(layer, null))) {
        layer = gd.new_("CanvasLayer", []);
        layer.name = LAYER_NAME;
        layer.layer = 99;
        let rect = gd.new_("ColorRect", []);
        call(rect, "set_anchors_preset", gd.member(gd.cls("Control"), "PRESET_FULL_RECT"));
        rect.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
        let shader = gd.new_("Shader", []);
        shader.code = SHADER;
        rect.material = gd.new_("ShaderMaterial", []);
        ((__o) => { const __t = __o.material; __t.shader = shader; if (gd.isValue(__t)) __o.material = __t; return __t.shader; })(rect);
        call(layer, "add_child", rect);
        call(room, "add_child", layer);
      }
      call(gd.member(call(layer, "get_child", 0), "material"), "set_shader_parameter", "scale", scale);
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {

    }
  }
  Object.assign(ScummRoomIntensityCommand, { LAYER_NAME, SHADER });
  return ScummRoomIntensityCommand;
}
