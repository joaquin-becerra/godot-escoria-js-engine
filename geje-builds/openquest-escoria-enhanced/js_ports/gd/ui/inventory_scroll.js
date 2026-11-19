// Translated from res://ui/inventory_scroll.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class inventory_scroll extends gd.base("Button") {
    constructor(...args) {
      super(...args);
      this.__field("step", this.__export("step", 0));
    }
    _ready() {
      call(gd.member(this, "pressed"), "connect", (() => { return this.get_node("../ScrollContainer").scroll_vertical = op.add(this.get_node("../ScrollContainer").scroll_vertical, this.step); }));
    }
  }
  return inventory_scroll;
}
