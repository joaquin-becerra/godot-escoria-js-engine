// Translated from res://ui/scumm_screen.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const GLOBAL = "scumm_effect_code";
  const EFFECTS = { [1]: ["res://ui/transitions/fx_1.png", 0.217], [2]: ["res://ui/transitions/fx_2.png", 0.417], [3]: ["res://ui/transitions/fx_3.png", 0.417], [4]: ["res://ui/transitions/fx_4.png", 0.417], [5]: ["res://ui/transitions/fx_5.png", 0.15], [6]: ["res://ui/transitions/fx_6.png", 0.267], [128]: ["res://ui/transitions/fx_128.png", 0.075], [134]: ["res://ui/transitions/fx_134.png", 0.3], [135]: ["res://ui/transitions/fx_135.png", 0.6] };
  const SCROLLS = { [130]: [G.Vector2(1, 0), 0.667, 40], [131]: [G.Vector2(-1, 0), 0.667, 40], [132]: [G.Vector2(0, 1), 0.3, 18], [133]: [G.Vector2(0, -1), 0.3, 18] };
  const SIZE = G.Vector2(1280, 576);
  const SHADER = "\nshader_type canvas_item;\nuniform sampler2D screen : hint_screen_texture, filter_nearest;\nuniform sampler2D old_picture : filter_nearest;\nuniform sampler2D mask : filter_nearest;\nuniform float progress = 0.0;\nuniform float area = 1.0;           // room area height / viewport height\nuniform bool old_black = false;\nuniform bool new_black = false;     // fading out: the new picture is black\nuniform vec2 scroll = vec2(0.0);\nuniform float steps = 1.0;\n\nvec4 old_at(vec2 uv) {\n\treturn old_black ? vec4(0.0, 0.0, 0.0, 1.0) : texture(old_picture, uv);\n}\nvec4 new_at(vec2 uv) {\n\treturn new_black ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(texture(screen, vec2(uv.x, uv.y * area)).rgb, 1.0);\n}\nvoid fragment() {\n\tif (scroll != vec2(0.0)) {\n\t\t// SCUMM scrolls 8 pixels at a time.\n\t\tvec2 q = UV - scroll * floor(progress * steps) / steps;\n\t\tif (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0)\n\t\t\tCOLOR = old_at(q);\n\t\telse\n\t\t\tCOLOR = new_at(q + scroll);\n\t} else {\n\t\tCOLOR = texture(mask, UV).r <= progress ? new_at(UV) : old_at(UV);\n\t}\n}\n";
  class ScummScreen extends gd.base("CanvasLayer") {
    constructor(...args) {
      super(...args);
      this.__field("_rect", null);
      this.__field("_material", null);
      this.__field("_effect_flag", true);
      if (new.target === ScummScreen) this._init(...gd.initArgs(args));
    }
    static get_screen() {
      let screen = gd.escoria.get_node_or_null("ScummScreen");
      if (truthy(op.eq(screen, null))) {
        screen = gd.new_("ScummScreen", []);
        screen.name = "ScummScreen";
        gd.escoria.add_child(screen);
      }
      return screen;
    }
    static effect_code() {
      if (truthy(gd.member(gd.escoria, "globals_manager").has(GLOBAL))) {
        return G.int(gd.member(gd.escoria, "globals_manager").get_global(GLOBAL));
      }
      return 0;
    }
    _init() {
      this.layer = 100;
      let shader = gd.new_("Shader", []);
      shader.code = SHADER;
      this._material = gd.new_("ShaderMaterial", []);
      this._material.shader = shader;
      this._rect = gd.new_("ColorRect", []);
      this._rect.size = SIZE;
      this._rect.material = this._material;
      this._rect.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      this._rect.visible = false;
      this.add_child(this._rect);
    }
    _fit() {
      let view = gd.member(call(this.get_viewport(), "get_visible_rect"), "size");
      this._rect.size = G.Vector2(gd.member(view, "x"), gd.member(SIZE, "y"));
      call(this._material, "set_shader_parameter", "area", op.div(gd.member(SIZE, "y"), gd.member(view, "y")));
    }
    async fade_out(from_black = false) {
      let effect = (((this.constructor.effect_code() >> 8)) & 255);
      this._reset();
      this._fit();
      if (truthy(from_black)) {
        call(this._material, "set_shader_parameter", "old_black", true);
      } else {
        (await gd.member(gd.singleton("RenderingServer"), "frame_post_draw"));
        let image = call(call(this.get_viewport(), "get_texture"), "get_image");
        let view_h = gd.member(gd.member(call(this.get_viewport(), "get_visible_rect"), "size"), "y");
        let area = G.Rect2i(gd.member(gd.cls("Vector2i"), "ZERO"), G.Vector2i(call(image, "get_width"), G.int(op.div(op.mul(call(image, "get_height"), gd.member(SIZE, "y")), view_h))));
        call(this._material, "set_shader_parameter", "old_picture", gd.cls("ImageTexture").create_from_image(call(image, "get_region", area)));
      }
      this._rect.visible = true;
      if (truthy((truthy((truthy(this._effect_flag) && truthy(op.ne(effect, 0)))) && truthy(!truthy(from_black))))) {
        if (truthy(op.eq(effect, 129))) {
          call(this._material, "set_shader_parameter", "old_black", true);
        } else if (truthy(call(EFFECTS, "has", effect))) {
          call(this._material, "set_shader_parameter", "mask", G.load(op.get(op.get(EFFECTS, effect), 0)));
          call(this._material, "set_shader_parameter", "new_black", true);
          (await this._play(op.get(op.get(EFFECTS, effect), 1)));
          call(this._material, "set_shader_parameter", "old_black", true);
          call(this._material, "set_shader_parameter", "new_black", false);
          call(this._material, "set_shader_parameter", "progress", 0.0);
        }
      }
      this._effect_flag = false;
      for (let i of iter(2)) {
        (await gd.member(gd.singleton("RenderingServer"), "frame_post_draw"));
      }
    }
    async fade_in() {
      this._effect_flag = true;
      if (truthy(!truthy(gd.member(this._rect, "visible")))) {
        return;
      }
      this._fit();
      let effect = (this.constructor.effect_code() & 255);
      if (truthy(call(EFFECTS, "has", effect))) {
        call(this._material, "set_shader_parameter", "mask", G.load(op.get(op.get(EFFECTS, effect), 0)));
        (await this._play(op.get(op.get(EFFECTS, effect), 1)));
      } else if (truthy(call(SCROLLS, "has", effect))) {
        call(this._material, "set_shader_parameter", "scroll", op.get(op.get(SCROLLS, effect), 0));
        call(this._material, "set_shader_parameter", "steps", G.float(op.get(op.get(SCROLLS, effect), 2)));
        (await this._play(op.get(op.get(SCROLLS, effect), 1)));
      }
      this._rect.visible = false;
      this._reset();
    }
    async _play(seconds) {
      let tween = this.create_tween();
      call(call(tween, "tween_property", this._material, "shader_parameter/progress", 1.0, seconds), "from", 0.0);
      (await gd.member(tween, "finished"));
    }
    _reset() {
      call(this._material, "set_shader_parameter", "progress", 0.0);
      call(this._material, "set_shader_parameter", "old_black", false);
      call(this._material, "set_shader_parameter", "new_black", false);
      call(this._material, "set_shader_parameter", "scroll", gd.member(gd.cls("Vector2"), "ZERO"));
    }
  }
  Object.assign(ScummScreen, { GLOBAL, EFFECTS, SCROLLS, SIZE, SHADER });
  return ScummScreen;
}
