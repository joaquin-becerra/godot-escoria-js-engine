// Translated from res://game/ui/sosage/sosage_interface.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const IMG = "res://game/images/interface/";
  const CURSOR_SCALE = 0.5;
  const SELECTED_SCALE = 0.28;
  const LABEL_MARGIN = 20.0;
  const WORLD = G.Vector2(1920, 1080);
  const DEPLOY_TIME = 0.25;
  const WRIGGLE_RANGE = 5.0;
  const WRIGGLE_PERIOD = 0.75;
  const _ORIENT = { "up": { "button": G.Vector2(0, -40), "label": G.Vector2(0, -80), "start": G.Vector2(0, -14), "kind": gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "PLAIN") }, "down": { "button": G.Vector2(0, 40), "label": G.Vector2(0, 80), "start": G.Vector2(0, 14), "kind": gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "PLAIN") }, "left": { "button": G.Vector2(-40, 0), "label": G.Vector2(-40, 0), "start": G.Vector2(-14, 0), "kind": gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "OPEN_RIGHT") }, "right": { "button": G.Vector2(40, 0), "label": G.Vector2(40, 0), "start": G.Vector2(14, 0), "kind": gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "OPEN_LEFT") } };
  class SosageInterface extends gd.base("CanvasLayer") {
    constructor(...args) {
      super(...args);
      this.__field("_cursors", { "default": [gd.preload(op.add(IMG, "cursor.png")), G.Vector2(0.1, 0.1)], "object": [gd.preload(op.add(IMG, "cursor_object.png")), G.Vector2(0.5, 0.5)], "goto_left": [gd.preload(op.add(IMG, "gauche_aller.png")), G.Vector2(1.0, 0.5)], "goto_right": [gd.preload(op.add(IMG, "droite_aller.png")), G.Vector2(0.0, 0.5)], "selected": [gd.preload(op.add(IMG, "big_circle.png")), G.Vector2(0.5, 0.5)] });
      this.__field("cursor_state", "default");
      this.__field("_root", null);
      this.__field("_cursor_layer", null);
      this.__field("_cursor", null);
      this.__field("_selected_item", null);
      this.__field("_hover", null);
      this.__field("_hover_mode", "");
      this.__field("_blocker", null);
      this.__field("_choice_nodes", []);
      this.__field("_choice_motion", []);
      this.__field("_selector_time", 0.0);
    }
    get choice_made() { return this.signal("choice_made"); }
    _ready() {
      this.add_to_group("sosage_interface");
      this.process_mode = gd.member(gd.cls("Node"), "PROCESS_MODE_ALWAYS");
      this.layer = 10;
      this._root = gd.new_("Control", []);
      this._root.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      this._root.size = WORLD;
      this.add_child(this._root);
      this._cursor_layer = gd.new_("CanvasLayer", []);
      this._cursor_layer.layer = 128;
      this.add_child(this._cursor_layer);
      this._selected_item = gd.new_("Sprite2D", []);
      this._selected_item.scale = G.Vector2(SELECTED_SCALE, SELECTED_SCALE);
      this._selected_item.visible = false;
      this._cursor = gd.new_("Sprite2D", []);
      this._cursor.centered = false;
      this._cursor.scale = G.Vector2(CURSOR_SCALE, CURSOR_SCALE);
      call(this._cursor_layer, "add_child", this._cursor);
      call(this._cursor_layer, "add_child", this._selected_item);
      this.set_cursor("default");
      gd.singleton("Input").mouse_mode = gd.member(gd.singleton("Input"), "MOUSE_MODE_HIDDEN");
    }
    _exit_tree() {
      gd.singleton("Input").mouse_mode = gd.member(gd.singleton("Input"), "MOUSE_MODE_VISIBLE");
    }
    _process(delta) {
      if (truthy(!truthy(call(this._choice_motion, "is_empty")))) {
        this._animate_selector(delta);
      }
      let p = this.mouse_position();
      this._cursor.position = p;
      this._selected_item.position = p;
      if (truthy((truthy(op.ne(this._hover, null)) && truthy(op.eq(this._hover_mode, "cursor"))))) {
        this._place_cursor_label(p);
      }
    }
    mouse_position() {
      return call(this._root, "get_global_mouse_position");
    }
    set_cursor(state, item_texture = null) {
      this.cursor_state = state;
      let c = op.get(this._cursors, state);
      let tex = op.get(c, 0);
      this._cursor.texture = tex;
      this._cursor.offset = op.mul(op.neg(call(tex, "get_size")), op.get(c, 1));
      if (truthy((truthy(op.eq(state, "selected")) && truthy(op.ne(item_texture, null))))) {
        this._selected_item.texture = item_texture;
        this._selected_item.visible = true;
      } else if (truthy(op.ne(state, "selected"))) {
        this._selected_item.visible = false;
      }
    }
    show_cursor_label(text, kind) {
      this.clear_label();
      if (truthy(op.eq(text, ""))) {
        return;
      }
      let k = gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "CURSOR_LEFT");
      if (truthy(op.eq(kind, "goto_left"))) {
        k = gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "GOTO_LEFT");
      } else if (truthy(op.eq(kind, "goto_right"))) {
        k = gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "GOTO_RIGHT");
      }
      this._hover = gd.cls("SosageLabel").make(text, k);
      this._hover_mode = "cursor";
      call(this._root, "add_child", this._hover);
      this._place_cursor_label(this.mouse_position());
      this._fade_in(this._hover);
    }
    show_fixed_label(text, center) {
      this.clear_label();
      if (truthy(op.eq(text, ""))) {
        return;
      }
      this._hover = gd.cls("SosageLabel").make(text, gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "PLAIN"));
      this._hover_mode = "fixed";
      call(this._root, "add_child", this._hover);
      call(this._hover, "place", center);
      this._clamp_x(this._hover, LABEL_MARGIN);
      this._fade_in(this._hover);
    }
    clear_label() {
      if (truthy(op.ne(this._hover, null))) {
        call(this._hover, "queue_free");
        this._hover = null;
      }
      this._hover_mode = "";
    }
    _place_cursor_label(p) {
      call(this._hover, "place", p);
      if (truthy((truthy(op.eq(gd.member(this._hover, "kind"), gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "CURSOR_LEFT"))) && truthy((op.add(gd.member(gd.member(this._hover, "position"), "x"), gd.member(gd.member(this._hover, "size"), "x")) > op.sub(gd.member(WORLD, "x"), gd.member(gd.cls("SosageLabel"), "HEIGHT"))))))) {
        this._hover.kind = gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "CURSOR_RIGHT");
        call(this._hover, "_layout");
        call(this._hover, "place", p);
      } else if (truthy((truthy(op.eq(gd.member(this._hover, "kind"), gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "CURSOR_RIGHT"))) && truthy((op.add(gd.member(p, "x"), gd.member(gd.member(this._hover, "size"), "x")) <= op.sub(gd.member(WORLD, "x"), gd.member(gd.cls("SosageLabel"), "HEIGHT"))))))) {
        this._hover.kind = gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "CURSOR_LEFT");
        call(this._hover, "_layout");
        call(this._hover, "place", p);
      }
    }
    is_selector_open() {
      return op.ne(this._blocker, null);
    }
    open_selector(point, choices) {
      this.close_selector();
      this.clear_label();
      this._blocker = gd.new_("Control", []);
      this._blocker.size = WORLD;
      this._blocker.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_STOP");
      call(gd.member(this._blocker, "gui_input"), "connect", gd.Callable(this, "_on_blocker_input"));
      call(this._root, "add_child", this._blocker);
      point = this._keep_selector_on_screen(point, choices);
      for (let c of iter(choices)) {
        let id = op.get(c, 0);
        let o = op.get(_ORIENT, op.get(c, 2));
        let label = gd.cls("SosageLabel").make(op.get(c, 1), op.get(o, "kind"));
        let button = gd.cls("SosageLabel").make("", gd.member(gd.member(gd.cls("SosageLabel"), "Kind"), "BUTTON"));
        for (let n of iter([label, button])) {
          n.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_STOP");
          call(gd.member(n, "gui_input"), "connect", call(gd.Callable(this, "_on_choice_input"), "bind", id));
          call(gd.member(n, "mouse_entered"), "connect", (() => { return button.highlighted = true; }));
          call(gd.member(n, "mouse_exited"), "connect", (() => { return button.highlighted = false; }));
          call(this._root, "add_child", n);
          call(this._choice_nodes, "append", n);
        }
        call(label, "place", op.add(point, op.get(o, "label")));
        call(button, "place", op.add(point, op.get(o, "button")));
        let dir = call(op.get(o, "button"), "normalized");
        call(this._choice_motion, "append", [button, gd.member(button, "position"), op.add(op.sub(gd.member(button, "position"), op.get(o, "button")), op.get(o, "start")), dir]);
        call(this._choice_motion, "append", [label, gd.member(label, "position"), gd.member(label, "position"), dir]);
        button.scale = op.mul(gd.member(gd.cls("Vector2"), "ONE"), ((0.177 / 0.5)));
        label.scale = op.mul(gd.member(gd.cls("Vector2"), "ONE"), 0.1);
        ((__o) => { const __t = __o.modulate; __t.a = 0.0; if (gd.isValue(__t)) __o.modulate = __t; return __t.a; })(label);
        let t = call(this.create_tween(), "set_parallel");
        call(t, "tween_property", button, "scale", gd.member(gd.cls("Vector2"), "ONE"), DEPLOY_TIME);
        call(t, "tween_property", label, "scale", gd.member(gd.cls("Vector2"), "ONE"), DEPLOY_TIME);
        call(t, "tween_property", label, "modulate:a", 1.0, DEPLOY_TIME);
      }
      this._selector_time = 0.0;
      this._animate_selector(0.0);
    }
    _animate_selector(delta) {
      this._selector_time = op.add(this._selector_time, delta);
      let deploy = G.clamp(op.div(this._selector_time, DEPLOY_TIME), 0.0, 1.0);
      let wriggle = op.mul(WRIGGLE_RANGE, (op.add(0.5, op.mul(0.5, G.sin(op.add(op.sub(op.div(op.neg(G.PI), 2), DEPLOY_TIME), op.div(this._selector_time, WRIGGLE_PERIOD)))))));
      for (let m of iter(this._choice_motion)) {
        if (truthy(G.is_instance_valid(op.get(m, 0)))) {
          ((__o) => { const __t = op.get(__o, 0); __t.position = op.add(call(op.get(m, 2), "lerp", op.get(m, 1), deploy), op.mul(op.get(m, 3), wriggle)); if (gd.isValue(__t)) op.set(__o, 0, __t); return __t.position; })(m);
        }
      }
    }
    close_selector() {
      for (let n of iter(this._choice_nodes)) {
        if (truthy(G.is_instance_valid(n))) {
          call(n, "queue_free");
        }
      }
      call(this._choice_nodes, "clear");
      call(this._choice_motion, "clear");
      if (truthy(op.ne(this._blocker, null))) {
        call(this._blocker, "queue_free");
        this._blocker = null;
      }
    }
    _keep_selector_on_screen(point, choices) {
      let shift = gd.member(gd.cls("Vector2"), "ZERO");
      for (let c of iter(choices)) {
        let o = op.get(_ORIENT, op.get(c, 2));
        let probe = gd.cls("SosageLabel").make(op.get(c, 1), op.get(o, "kind"));
        call(probe, "place", op.add(point, op.get(o, "label")));
        let r = G.Rect2(gd.member(probe, "position"), gd.member(probe, "size"));
        call(probe, "free");
        if (truthy((gd.member(gd.member(r, "position"), "x") < LABEL_MARGIN))) {
          shift.x = G.max(gd.member(shift, "x"), op.sub(LABEL_MARGIN, gd.member(gd.member(r, "position"), "x")));
        }
        if (truthy((gd.member(gd.member(r, "end"), "x") > op.sub(gd.member(WORLD, "x"), LABEL_MARGIN)))) {
          shift.x = G.min(gd.member(shift, "x"), op.sub(op.sub(gd.member(WORLD, "x"), LABEL_MARGIN), gd.member(gd.member(r, "end"), "x")));
        }
        if (truthy((gd.member(gd.member(r, "position"), "y") < LABEL_MARGIN))) {
          shift.y = G.max(gd.member(shift, "y"), op.sub(LABEL_MARGIN, gd.member(gd.member(r, "position"), "y")));
        }
        if (truthy((gd.member(gd.member(r, "end"), "y") > op.sub(gd.member(WORLD, "y"), LABEL_MARGIN)))) {
          shift.y = G.min(gd.member(shift, "y"), op.sub(op.sub(gd.member(WORLD, "y"), LABEL_MARGIN), gd.member(gd.member(r, "end"), "y")));
        }
      }
      return op.add(point, shift);
    }
    _on_choice_input(event, id) {
      if (truthy((truthy((truthy(gd.is(event, "InputEventMouseButton")) && truthy(gd.member(event, "pressed")))) && truthy(op.eq(gd.member(event, "button_index"), G.MOUSE_BUTTON_LEFT))))) {
        call(this.get_viewport(), "set_input_as_handled");
        this.close_selector();
        call(this.signal("choice_made"), "emit", id);
      }
    }
    _on_blocker_input(event) {
      if (truthy((truthy(gd.is(event, "InputEventMouseButton")) && truthy(gd.member(event, "pressed"))))) {
        call(this.get_viewport(), "set_input_as_handled");
        this.close_selector();
        call(this.signal("choice_made"), "emit", "");
      }
    }
    _fade_in(node) {
      ((__o) => { const __t = __o.modulate; __t.a = 0.0; if (gd.isValue(__t)) __o.modulate = __t; return __t.a; })(node);
      call(this.create_tween(), "tween_property", node, "modulate:a", 1.0, DEPLOY_TIME);
    }
    _clamp_x(node, margin) {
      ((__o) => { const __t = __o.position; __t.x = G.clamp(gd.member(gd.member(node, "position"), "x"), margin, op.sub(op.sub(gd.member(WORLD, "x"), margin), gd.member(gd.member(node, "size"), "x"))); if (gd.isValue(__t)) __o.position = __t; return __t.x; })(node);
    }
  }
  Object.assign(SosageInterface, { IMG, CURSOR_SCALE, SELECTED_SCALE, LABEL_MARGIN, WORLD, DEPLOY_TIME, WRIGGLE_RANGE, WRIGGLE_PERIOD, _ORIENT });
  return SosageInterface;
}
