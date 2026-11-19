// Translated from res://commands/scumm_set_name.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const PREFIX = "scumm_name_";
  class ScummSetNameCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [2, [G.TYPE_STRING, G.TYPE_STRING], [null, null]]);
    }
    run(command_params) {
      gd.member(gd.escoria, "globals_manager").set_global(op.add(PREFIX, op.get(command_params, 0)), op.get(command_params, 1), true);
      this.constructor.apply(op.get(command_params, 0), op.get(command_params, 1));
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    static apply(global_id, name) {
      if (truthy(gd.member(gd.escoria, "object_manager").has(global_id))) {
        let obj = gd.member(gd.escoria, "object_manager").get_object(global_id);
        if (truthy((truthy((truthy(obj) && truthy(G.is_instance_valid(gd.member(obj, "node"))))) && truthy(op.in("tooltip_name", gd.member(obj, "node")))))) {
          ((__o) => { const __t = __o.node; __t.tooltip_name = name; if (gd.isValue(__t)) __o.node = __t; return __t.tooltip_name; })(obj);
        }
      }
    }
    interrupt() {

    }
  }
  Object.assign(ScummSetNameCommand, { PREFIX });
  return ScummSetNameCommand;
}
