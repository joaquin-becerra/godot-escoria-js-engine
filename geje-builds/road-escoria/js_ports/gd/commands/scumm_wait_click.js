// Translated from res://commands/scumm_wait_click.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  class _Waiter extends gd.base("Node") {
    constructor(...args) {
      super(...args);
    }
    get clicked() { return this.signal("clicked"); }
    _input(event) {
      if (truthy((truthy(gd.is(event, "InputEventMouseButton")) && truthy(gd.member(event, "pressed"))))) {
        call(this.get_viewport(), "set_input_as_handled");
        call(this.signal("clicked"), "emit");
      }
    }
  }
  class ScummWaitClickCommand extends gd.base("ESCBaseCommand") {
    constructor(...args) {
      super(...args);
      this.__field("_waiter", null);
    }
    configure() {
      return gd.new_("ESCCommandArgumentDescriptor", [0, [], []]);
    }
    async run(_command_params) {
      this._waiter = new _Waiter();
      gd.escoria.add_child(this._waiter);
      (await gd.member(this._waiter, "clicked"));
      call(this._waiter, "queue_free");
      this._waiter = null;
      return gd.member(gd.cls("ESCExecution"), "RC_OK");
    }
    interrupt() {
      if (truthy(G.is_instance_valid(this._waiter))) {
        call(gd.member(this._waiter, "clicked"), "emit");
      }
    }
  }
  return ScummWaitClickCommand;
}
