// Translated from res://ui/scumm_defaults.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const CLASSES = ["ClassUntouchable", "Openable", "Person", "Pickable"];
  class ScummDefaults extends gd.base("RefCounted") {
    constructor(...args) {
      super(...args);
    }
    static publish(a, b) {
      this._publish_one("a", a);
      this._publish_one("b", b);
      let inventory = "";
      if (truthy((truthy((truthy(a) && truthy(G.is_instance_valid(gd.member(a, "node"))))) && truthy(call(gd.member(gd.member(a, "node"), "custom_data"), "has", "scumm_inventory_object"))))) {
        inventory = op.get(gd.member(gd.member(a, "node"), "custom_data"), "scumm_inventory_object");
      }
      gd.member(gd.escoria, "globals_manager").set_global("scumm_inventory_a", inventory, true);
    }
    static _publish_one(which, obj) {
      let classes = [];
      if (truthy((truthy((truthy(obj) && truthy(G.is_instance_valid(gd.member(obj, "node"))))) && truthy(op.in("custom_data", gd.member(obj, "node")))))) {
        classes = call(gd.member(gd.member(obj, "node"), "custom_data"), "get", "scumm_classes", []);
      }
      gd.member(gd.escoria, "globals_manager").set_global(op.add("scumm_object_", which), (truthy(obj) ? gd.member(obj, "global_id") : ""), true);
      for (let cls of iter(CLASSES)) {
        gd.member(gd.escoria, "globals_manager").set_global(op.mod("scumm_%s_%s", [which, call(cls, "to_snake_case")]), op.in(cls, classes), true);
      }
    }
  }
  Object.assign(ScummDefaults, { CLASSES });
  return ScummDefaults;
}
