// Translated from res://ui/sentence_line.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const LABELS = { "give": "Give", "pickup": "Pick up", "use": "Use", "open": "Open", "look": "Look at", "push": "Push", "close": "Close", "talk": "Talk to", "pull": "Pull", "walk": "Walk to" };
  const PREPOSITIONS = { "use": "with", "give": "to" };
  class sentence_line extends gd.base("ESCTooltip") {
    constructor(...args) {
      super(...args);
    }
    _ready() {
      super._ready?.();
      this.update_tooltip_text();
    }
    _preposition() {
      let tool = gd.member(gd.member(gd.escoria, "action_manager"), "current_tool");
      if (truthy((truthy((truthy(tool) && truthy(gd.member(tool, "node")))) && truthy(call(gd.member(gd.member(tool, "node"), "custom_data"), "has", op.add("preposition_", gd.member(this, "current_action"))))))) {
        return op.get(gd.member(gd.member(tool, "node"), "custom_data"), op.add("preposition_", gd.member(this, "current_action")));
      }
      return call(PREPOSITIONS, "get", gd.member(this, "current_action"), call(gd.member(this, "current_prep"), "strip_edges"));
    }
    update_tooltip_text() {
      let verb = call(LABELS, "get", gd.member(this, "current_action"), op.get(LABELS, "walk"));
      let line = verb;
      if (truthy(!truthy(call(gd.member(this, "current_target"), "is_empty")))) {
        line = op.add(line, op.add(" ", gd.member(this, "current_target")));
      }
      let state = gd.member(gd.member(gd.escoria, "action_manager"), "action_state");
      if (truthy((truthy(op.ne(state, gd.member(gd.member(gd.cls("ESCActionManager"), "ActionInputState"), "AWAITING_TARGET_ITEM"))) && truthy(op.ne(state, gd.member(gd.member(gd.cls("ESCActionManager"), "ActionInputState"), "COMPLETED")))))) {
        this.waiting_for_target2 = false;
        this.current_target2 = "";
      }
      if (truthy((truthy(gd.member(this, "waiting_for_target2")) || truthy(!truthy(call(gd.member(this, "current_target2"), "is_empty")))))) {
        line = op.add(line, op.add(" ", this._preposition()));
      }
      if (truthy(!truthy(call(gd.member(this, "current_target2"), "is_empty")))) {
        line = op.add(line, op.add(" ", gd.member(this, "current_target2")));
      }
      this.text = op.add(op.add(op.add(op.add("[center][color=#", call(gd.member(this, "color"), "to_html", false)), "]"), line), "[/color][/center]");
    }
  }
  Object.assign(sentence_line, { LABELS, PREPOSITIONS });
  return sentence_line;
}
