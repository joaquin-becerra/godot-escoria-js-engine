// Translated from res://ui/loading_spinner.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const CENTER = G.Vector2(640, 288);
  const RADIUS = 28.0;
  const WIDTH = 6.0;
  const COLOR = G.Color(0.886, 0.875, 0.863);
  const SPEED = G.TAU;
  class LoadingSpinner extends gd.base("CanvasLayer") {
    constructor(...args) {
      super(...args);
      this.__field("_room", null);
      this.__field("_angle", 0.0);
      this.__field("_arc", null);
      if (new.target === LoadingSpinner) this._init(...gd.initArgs(args));
    }
    static start() {
      if (truthy(op.ne(gd.escoria.get_node_or_null("LoadingSpinner"), null))) {
        return;
      }
      let spinner = gd.new_("LoadingSpinner", []);
      spinner.name = "LoadingSpinner";
      gd.escoria.add_child(spinner);
    }
    _init() {
      this.layer = 101;
      this.process_mode = G.PROCESS_MODE_ALWAYS;
      this._arc = gd.new_("Control", []);
      this._arc.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      call(gd.member(this._arc, "draw"), "connect", gd.Callable(this, "_draw_arc"));
      this.add_child(this._arc);
    }
    _ready() {
      this._room = gd.member(gd.member(gd.escoria, "main"), "current_scene");
    }
    _process(delta) {
      if (truthy(op.ne(gd.member(gd.member(gd.escoria, "main"), "current_scene"), this._room))) {
        this.queue_free();
        return;
      }
      this._angle = G.fmod(op.add(this._angle, op.mul(SPEED, delta)), G.TAU);
      call(this._arc, "queue_redraw");
    }
    _draw_arc() {
      call(this._arc, "draw_arc", CENTER, RADIUS, this._angle, op.add(this._angle, op.mul(G.TAU, 0.75)), 32, COLOR, WIDTH, true);
    }
  }
  Object.assign(LoadingSpinner, { CENTER, RADIUS, WIDTH, COLOR, SPEED });
  return LoadingSpinner;
}
