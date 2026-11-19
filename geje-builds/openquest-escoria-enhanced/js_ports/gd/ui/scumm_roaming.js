// Translated from res://ui/scumm_roaming.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const PREFIX = "scumm_roam_";
  const DELAY_MIN = 0.833;
  const DELAY_MAX = 3.333;
  const CHANCE = 0.5;
  class ScummRoaming extends gd.base("Node") {
    constructor(...args) {
      super(...args);
      this.__field("_timers", {  });
    }
    static get_node_instance() {
      let node = gd.escoria.get_node_or_null("ScummRoaming");
      if (truthy(op.eq(node, null))) {
        node = gd.new_("ScummRoaming", []);
        node.name = "ScummRoaming";
        gd.escoria.add_child(node);
      }
      return node;
    }
    control(actor, op_, rect) {
      if (truthy(op.eq(op_, "setup"))) {
        return;
      }
      let state = this._state(actor);
      {
        const __m1 = op_;
        if (op.eq(__m1, "start")) {
          state = op.add(["running"], rect);
        }
        else if (op.eq(__m1, "pause") || op.eq(__m1, "resume") || op.eq(__m1, "stop")) {
          if (truthy((truthy(call(state, "is_empty")) || truthy(op.eq(op.get(state, 0), "stopped"))))) {
            return;
          }
          op.set(state, 0, op.get({ "pause": "paused", "resume": "running", "stop": "stopped" }, op_));
        }
      }
      gd.member(gd.escoria, "globals_manager").set_global(op.add(PREFIX, actor), call(",", "join", call(state, "map", ((v) => {
      return G.str(v);
    }))), true);
      if (truthy(op.in(op_, ["pause", "stop"]))) {
        let node = this._node(actor);
        if (truthy((truthy(node) && truthy(call(node, "is_moving"))))) {
          call(node, "stop_walking_now");
        }
      }
    }
    _process(delta) {
      let globals = gd.member(gd.escoria, "globals_manager").get_globals();
      for (let key of iter(globals)) {
        if (truthy(!truthy(call(G.str(key), "begins_with", PREFIX)))) {
          continue;
        }
        let actor = call(G.str(key), "substr", call(PREFIX, "length"));
        let state = this._state(actor);
        if (truthy((truthy((call(state, "size") < 5)) || truthy(op.ne(op.get(state, 0), "running"))))) {
          continue;
        }
        op.set(this._timers, actor, op.sub(call(this._timers, "get", actor, 0.0), delta));
        if (truthy((op.get(this._timers, actor) > 0.0))) {
          continue;
        }
        op.set(this._timers, actor, G.randf_range(DELAY_MIN, DELAY_MAX));
        if (truthy((G.randf() >= CHANCE))) {
          continue;
        }
        let node = this._node(actor);
        if (truthy((truthy((truthy((truthy(op.eq(node, null)) || truthy(!truthy(call(node, "is_visible_in_tree"))))) || truthy(call(node, "is_moving")))) || truthy(!truthy(gd.member(gd.escoria, "event_manager").is_channel_free(gd.member(gd.member(gd.escoria, "event_manager"), "CHANNEL_FRONT"))))))) {
          continue;
        }
        let target = G.Vector2(G.randi_range(G.int(op.get(state, 1)), G.int(op.get(state, 2))), G.randi_range(G.int(op.get(state, 3)), G.int(op.get(state, 4))));
        call(node, "walk_to", target, gd.new_("ESCWalkContext", [null, target, false, true]));
      }
    }
    _state(actor) {
      if (truthy(!truthy(gd.member(gd.escoria, "globals_manager").has(op.add(PREFIX, actor))))) {
        return [];
      }
      return G.Array(call(G.str(gd.member(gd.escoria, "globals_manager").get_global(op.add(PREFIX, actor))), "split", ","));
    }
    _node(actor) {
      if (truthy(!truthy(gd.member(gd.escoria, "object_manager").has(actor)))) {
        return null;
      }
      let obj = gd.member(gd.escoria, "object_manager").get_object(actor);
      return (truthy((truthy(obj) && truthy(G.is_instance_valid(gd.member(obj, "node"))))) ? gd.member(obj, "node") : null);
    }
  }
  Object.assign(ScummRoaming, { PREFIX, DELAY_MIN, DELAY_MAX, CHANCE });
  return ScummRoaming;
}
