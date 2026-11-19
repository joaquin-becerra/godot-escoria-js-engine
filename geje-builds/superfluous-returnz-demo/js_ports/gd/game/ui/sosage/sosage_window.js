// Translated from res://game/ui/sosage/sosage_window.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const WORLD = G.Vector2(1920, 1080);
  const FADE = 0.25;
  const CLICK_TIME = 0.1;
  const RESULT_SUCCESS = gd.preload("res://game/images/interface/code_succes.png");
  const RESULT_FAILURE = gd.preload("res://game/images/interface/code_echec.png");
  const EFFECTS = "res://game/sounds/effects/";
  class SosageWindow extends gd.base("CanvasLayer") {
    constructor(...args) {
      super(...args);
      this.__field("success", false);
      this.__field("_root", null);
      this.__field("_image", null);
      this.__field("_code", {  });
      this.__field("_on_texture", null);
      this.__field("_proposal", []);
      this.__field("_flash", null);
      this.__field("_hover", null);
      this.__field("_locked", false);
      this.__field("_closing", false);
      this.__field("_sound", null);
    }
    get closed() { return this.signal("closed"); }
    static find_image(dir, name) {
      let locale = gd.singleton("TranslationServer").get_locale();
      let candidates = [];
      if (truthy(call(locale, "begins_with", "it"))) {
        call(candidates, "append", op.add(name, ".it_IT"));
      } else if (truthy(!truthy(call(locale, "begins_with", "fr")))) {
        call(candidates, "append", op.add(name, ".en_US"));
      }
      call(candidates, "append", name);
      for (let c of iter(candidates)) {
        let path = op.add(op.add(dir, c), ".png");
        if (truthy(gd.singleton("ResourceLoader").exists(path))) {
          return path;
        }
      }
      return "";
    }
    _ready() {
      this.layer = 20;
      this._root = gd.new_("Control", []);
      this._root.size = WORLD;
      this._root.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_STOP");
      call(gd.member(this._root, "gui_input"), "connect", gd.Callable(this, "_on_input"));
      this.add_child(this._root);
      this._sound = gd.new_("AudioStreamPlayer", []);
      if (truthy(op.ne(gd.singleton("AudioServer").get_bus_index("SFX"), -1))) {
        this._sound.bus = "SFX";
      }
      this.add_child(this._sound);
    }
    open(texture) {
      this._image = gd.new_("TextureRect", []);
      this._image.texture = texture;
      this._image.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      this._image.size = call(texture, "get_size");
      this._image.position = call((op.div((op.sub(WORLD, gd.member(this._image, "size"))), 2)), "round");
      call(this._root, "add_child", this._image);
      ((__o) => { const __t = __o.modulate; __t.a = 0.0; if (gd.isValue(__t)) __o.modulate = __t; return __t.a; })(this._image);
      call(this.create_tween(), "tween_property", this._image, "modulate:a", 1.0, FADE);
    }
    open_code(off, on, code) {
      this.open(off);
      if (truthy(call(code, "has", "cursor"))) {
        let ui = call(this.get_tree(), "get_first_node_in_group", "sosage_interface");
        if (truthy(ui)) {
          call(ui, "set_cursor", "selected", G.load(op.get(code, "cursor")));
        }
      }
      this._code = code;
      this._on_texture = on;
      this._hover = gd.new_("ColorRect", []);
      this._hover.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      let color = G.Color("5FD38D");
      let player = (truthy(gd.member(gd.member(gd.escoria, "main"), "current_scene")) ? gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "player") : null);
      if (truthy((truthy(player) && truthy(op.in("dialog_color", player))))) {
        color = gd.member(player, "dialog_color");
      }
      color.a = 0.5;
      this._hover.color = color;
      this._hover.visible = false;
      call(this._image, "add_child", this._hover);
      this._flash = gd.new_("TextureRect", []);
      this._flash.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      this._flash.visible = false;
      call(this._image, "add_child", this._flash);
    }
    _on_input(event) {
      if (truthy(this._closing)) {
        return;
      }
      if (truthy((truthy(gd.is(event, "InputEventMouseMotion")) && truthy(!truthy(call(this._code, "is_empty")))))) {
        let b = this._button_at(op.sub(gd.member(event, "position"), gd.member(this._image, "position")));
        this._hover.visible = (truthy(op.ne(b, null)) && truthy(!truthy(this._locked)));
        if (truthy(op.ne(b, null))) {
          this._hover.position = G.Vector2(op.get(b, 1), op.get(b, 2));
          this._hover.size = G.Vector2(op.get(b, 3), op.get(b, 4));
        }
      } else if (truthy((truthy((truthy(gd.is(event, "InputEventMouseButton")) && truthy(gd.member(event, "pressed")))) && truthy(op.eq(gd.member(event, "button_index"), G.MOUSE_BUTTON_LEFT))))) {
        call(this.get_viewport(), "set_input_as_handled");
        if (truthy(this._locked)) {
          return;
        }
        let p = op.sub(gd.member(event, "position"), gd.member(this._image, "position"));
        let inside = call(G.Rect2(gd.member(gd.cls("Vector2"), "ZERO"), gd.member(this._image, "size")), "has_point", p);
        if (truthy((truthy(call(this._code, "is_empty")) || truthy(!truthy(inside))))) {
          this.close();
        } else {
          let b = this._button_at(p);
          if (truthy(op.ne(b, null))) {
            this._press(b);
          }
        }
      }
    }
    _button_at(p) {
      for (let b of iter(call(this._code, "get", "buttons", []))) {
        if (truthy(call(G.Rect2(op.get(b, 1), op.get(b, 2), op.get(b, 3), op.get(b, 4)), "has_point", p))) {
          return b;
        }
      }
      return null;
    }
    _press(b) {
      let atlas = gd.new_("AtlasTexture", []);
      atlas.atlas = this._on_texture;
      atlas.region = G.Rect2(op.get(b, 1), op.get(b, 2), op.get(b, 3), op.get(b, 4));
      this._flash.texture = atlas;
      this._flash.position = G.Vector2(op.get(b, 1), op.get(b, 2));
      this._flash.size = G.Vector2(op.get(b, 3), op.get(b, 4));
      this._flash.visible = true;
      call(gd.member(call(this.get_tree(), "create_timer", CLICK_TIME), "timeout"), "connect", (() => { return this._flash.visible = false; }));
      call(this._proposal, "append", op.get(b, 0));
      let answer = op.get(this._code, "answer");
      if (truthy((call(this._proposal, "size") < call(answer, "size")))) {
        this._play(op.get(this._code, "button_sound"));
        return;
      }
      let ok = op.eq(this._proposal, answer);
      call(this._proposal, "clear");
      this._play((truthy(ok) ? op.get(this._code, "success_sound") : op.get(this._code, "failure_sound")));
      this._show_result(ok);
      if (truthy(ok)) {
        this.success = true;
        this._locked = true;
        this._hover.visible = false;
        call(gd.member(call(this.get_tree(), "create_timer", CLICK_TIME), "timeout"), "connect", gd.Callable(this, "close"));
      }
    }
    _show_result(ok) {
      let r = gd.new_("TextureRect", []);
      r.texture = (truthy(ok) ? RESULT_SUCCESS : RESULT_FAILURE);
      r.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      r.size = call(gd.member(r, "texture"), "get_size");
      r.position = call((op.div((op.sub(WORLD, gd.member(r, "size"))), 2)), "round");
      call(this._root, "add_child", r);
      call(gd.member(call(this.get_tree(), "create_timer", op.mul(CLICK_TIME, 5)), "timeout"), "connect", gd.member(r, "queue_free"));
    }
    _play(sound) {
      let path = op.add(op.add(EFFECTS, sound), ".ogg");
      if (truthy(gd.singleton("ResourceLoader").exists(path))) {
        this._sound.stream = G.load(path);
        call(this._sound, "play");
      }
    }
    async close() {
      if (truthy(this._closing)) {
        return;
      }
      this._closing = true;
      if (truthy(this._hover)) {
        this._hover.visible = false;
      }
      let t = this.create_tween();
      call(t, "tween_property", this._image, "modulate:a", 0.0, FADE);
      call(t, "tween_interval", (truthy(this.success) ? op.mul(CLICK_TIME, 4) : 0.0));
      (await gd.member(t, "finished"));
      if (truthy(call(this._code, "has", "cursor"))) {
        let ui = call(this.get_tree(), "get_first_node_in_group", "sosage_interface");
        if (truthy(ui)) {
          call(ui, "set_cursor", "default");
        }
      }
      call(this.signal("closed"), "emit");
    }
  }
  Object.assign(SosageWindow, { WORLD, FADE, CLICK_TIME, RESULT_SUCCESS, RESULT_FAILURE, EFFECTS });
  return SosageWindow;
}
