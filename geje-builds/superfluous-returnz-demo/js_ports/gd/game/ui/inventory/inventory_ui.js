// Translated from res://game/ui/inventory/inventory_ui.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const Mode = Object.freeze({ HIDDEN: 0, TAB: 1, OPEN: 2 });
  const WORLD_HEIGHT = 1080.0;
  const HEIGHT = 150.0;
  const ACTIVE_ZONE = 50.0;
  const SPEED = 0.25;
  const LABEL_MARGIN = 20.0;
  const ITEM_SCALE = 0.7;
  const ITEM_ACTIVE_SCALE = 0.9;
  class inventory_ui extends gd.base("ESCInventory") {
    constructor(...args) {
      super(...args);
      this.__field("mode", gd.member(Mode, "HIDDEN"));
      this.__field("_tween", null);
      this.__field("panel", null);
      this.__field("container", null);
    }
    __onready() {
      this.panel = this.get_node("panel");
      this.container = this.get_node("panel/container");
    }
    _ready() {
      super._ready?.();
      this.get_node("panel/tab/label").text = this.tr("Inventory");
      this._layout_tab();
      ((__o) => { const __t = __o.position; __t.y = this._target_y(gd.member(Mode, "HIDDEN")); if (gd.isValue(__t)) __o.position = __t; return __t.y; })(this.panel);
    }
    _notification(what) {
      if (truthy((truthy(op.eq(what, G.NOTIFICATION_TRANSLATION_CHANGED)) && truthy(this.is_node_ready())))) {
        this.get_node("panel/tab/label").text = this.tr("Inventory");
        this._layout_tab();
      }
    }
    _layout_tab() {
      let label = this.get_node("panel/tab/label");
      let font = call(label, "get_theme_font", "font");
      let tw = gd.member(call(font, "get_string_size", gd.member(label, "text"), G.HORIZONTAL_ALIGNMENT_LEFT, -1, call(label, "get_theme_font_size", "font_size")), "x");
      let w = G.ceilf(op.add(LABEL_MARGIN, tw));
      this.get_node("panel/tab").size = G.Vector2(w, ACTIVE_ZONE);
      ((__o) => { const __t = __o.position; __t.x = w; if (gd.isValue(__t)) __o.position = __t; return __t.x; })(this.get_node("panel/chamfer"));
    }
    _target_y(m) {
      {
        const __m1 = m;
        if (op.eq(__m1, gd.member(Mode, "OPEN"))) {
          return op.sub(WORLD_HEIGHT, HEIGHT);
        }
        else if (op.eq(__m1, gd.member(Mode, "TAB"))) {
          return WORLD_HEIGHT;
        }
      }
      return op.add(WORLD_HEIGHT, ACTIVE_ZONE);
    }
    set_mode(m) {
      if (truthy(op.eq(m, this.mode))) {
        return;
      }
      this.mode = m;
      if (truthy(op.ne(this._tween, null))) {
        call(this._tween, "kill");
      }
      this._tween = this.create_tween();
      call(this._tween, "tween_property", this.panel, "position:y", this._target_y(m), SPEED);
    }
    is_open() {
      return op.eq(this.mode, gd.member(Mode, "OPEN"));
    }
    tab_width() {
      return op.add(gd.member(gd.member(this.get_node("panel/chamfer"), "position"), "x"), gd.member(gd.member(this.get_node("panel/chamfer"), "size"), "x"));
    }
    open_top() {
      return op.sub(WORLD_HEIGHT, HEIGHT);
    }
    get_button(item_id) {
      for (let c of iter(call(this.container, "get_children"))) {
        if (truthy((truthy(gd.is(c, "ESCInventoryButton")) && truthy(op.eq(gd.member(c, "global_id"), item_id))))) {
          return c;
        }
      }
      return null;
    }
    set_item_active(item_id, active) {
      let b = this.get_button(item_id);
      if (truthy(op.eq(b, null))) {
        return;
      }
      b.pivot_offset = op.div(gd.member(b, "size"), 2);
      let s = (truthy(active) ? op.div(ITEM_ACTIVE_SCALE, ITEM_SCALE) : 1.0);
      b.scale = G.Vector2(s, s);
    }
    show_inventory() {
      this.set_mode(gd.member(Mode, "OPEN"));
    }
    hide_inventory() {
      this.set_mode(gd.member(Mode, "TAB"));
    }
  }
  Object.assign(inventory_ui, { Mode, WORLD_HEIGHT, HEIGHT, ACTIVE_ZONE, SPEED, LABEL_MARGIN, ITEM_SCALE, ITEM_ACTIVE_SCALE });
  return inventory_ui;
}
