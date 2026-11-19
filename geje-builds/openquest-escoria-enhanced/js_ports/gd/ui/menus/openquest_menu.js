// Translated from res://ui/menus/openquest_menu.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const MENU_MUSIC = "res://music/intro.ogg";
  class openquest_menu extends gd.base("Control") {
    constructor(...args) {
      super(...args);
      this.__field("is_pause", this.__export("is_pause", false));
      this.__field("_main", null);
      this.__field("_options", null);
      this.__field("_music", null);
    }
    __onready() {
      this._main = this.get_node("main");
      this._options = this.get_node("options");
    }
    _ready() {
      if (truthy(this.is_pause)) {
        this.process_mode = gd.member(gd.cls("Node"), "PROCESS_MODE_ALWAYS");
      }
      this.get_node("main/buttons/continue").visible = this.is_pause;
      this._music = gd.new_("AudioStreamPlayer", []);
      this._music.process_mode = gd.member(gd.cls("Node"), "PROCESS_MODE_ALWAYS");
      this._music.bus = "Music";
      let stream = G.load(MENU_MUSIC);
      stream.loop = true;
      this._music.stream = stream;
      this.add_child(this._music);
      call(gd.member(this, "visibility_changed"), "connect", gd.Callable(this, "_on_visibility_changed"));
      this.hide();
    }
    _on_visibility_changed() {
      let room_music = this._room_music();
      if (truthy(gd.member(this, "visible"))) {
        if (truthy(room_music)) {
          room_music.stream_paused = true;
        }
        call(this._music, "play");
      } else {
        call(this._music, "stop");
        if (truthy(room_music)) {
          room_music.stream_paused = false;
        }
      }
    }
    _room_music() {
      if (truthy(op.eq(gd.member(gd.escoria, "object_manager"), null))) {
        return null;
      }
      let music = gd.member(gd.escoria, "object_manager").get_object(gd.member(gd.cls("ESCObjectManager"), "MUSIC"));
      return (truthy((truthy(music) && truthy(gd.member(music, "node")))) ? gd.member(gd.member(music, "node"), "stream") : null);
    }
    _on_continue_pressed() {
      gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "game").unpause_game();
    }
    _on_new_game_pressed() {
      gd.escoria.new_game();
      if (truthy(this.is_pause)) {
        gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "game").unpause_game();
      }
    }
    _on_options_pressed() {
      call(this._main, "hide");
      call(this._options, "open");
    }
    _on_quit_pressed() {
      gd.escoria.quit();
    }
    _on_options_back_button_pressed() {
      this.reset();
    }
    reset() {
      call(this._options, "hide");
      call(this._main, "show");
    }
    set_save_enabled(_p_enabled) {

    }
  }
  Object.assign(openquest_menu, { MENU_MUSIC });
  return openquest_menu;
}
