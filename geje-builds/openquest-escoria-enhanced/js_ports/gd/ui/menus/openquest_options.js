// Translated from res://ui/menus/openquest_options.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const LANGUAGE_NAMES = { "en": "English", "es": "Español", "fr": "Français", "de": "Deutsch", "it": "Italiano", "pt": "Português" };
  const EFFECTS_SAMPLE = "res://sounds/phone_snd.wav";
  class openquest_options extends gd.base("Control") {
    constructor(...args) {
      super(...args);
      this.__field("_locales", []);
      this.__field("_sample", null);
      this.__field("_language", null);
      this.__field("_music", null);
      this.__field("_effects", null);
      this.__field("_graphics", null);
      this.__field("_screen", null);
    }
    __onready() {
      this._language = this.get_node("%language");
      this._music = this.get_node("%music");
      this._effects = this.get_node("%effects");
      this._graphics = this.get_node("%graphics");
      this._screen = this.get_node("%screen");
    }
    get back_button_pressed() { return this.signal("back_button_pressed"); }
    _ready() {
      for (let locale of iter(gd.singleton("TranslationServer").get_loaded_locales())) {
        if (truthy(!truthy(op.in(locale, this._locales)))) {
          call(this._locales, "append", locale);
          call(this._language, "add_item", call(LANGUAGE_NAMES, "get", locale, locale));
        }
      }
      this._language.auto_translate_mode = gd.member(gd.cls("Node"), "AUTO_TRANSLATE_MODE_DISABLED");
      call(this._language, "get_popup").auto_translate_mode = gd.member(gd.cls("Node"), "AUTO_TRANSLATE_MODE_DISABLED");
      call(this._graphics, "add_item", "GRAPHICS_ORIGINAL");
      call(this._graphics, "add_item", "GRAPHICS_HD");
      call(this._screen, "add_item", "SCREEN_WINDOW");
      call(this._screen, "add_item", "FULLSCREEN");
      for (let option of iter([this._language, this._graphics, this._screen])) {
        call(gd.member(call(option, "get_popup"), "about_to_popup"), "connect", call(gd.Callable(this, "_style_popup"), "bind", option));
      }
      this._sample = gd.new_("AudioStreamPlayer", []);
      this._sample.process_mode = gd.member(gd.cls("Node"), "PROCESS_MODE_ALWAYS");
      this._sample.bus = "SFX";
      this._sample.stream = G.load(EFFECTS_SAMPLE);
      this.add_child(this._sample);
    }
    open() {
      this._refresh();
      this.visible = true;
    }
    _refresh() {
      let lang = gd.cls("ESCProjectSettingsManager").get_setting(gd.member(gd.cls("ESCProjectSettingsManager"), "TEXT_LANG"));
      let i = call(this._locales, "find", lang);
      if (truthy((i < 0))) {
        i = call(this._locales, "find", call(gd.singleton("TranslationServer").get_locale(), "substr", 0, 2));
      }
      call(this._language, "select", i);
      call(this._music, "set_value_no_signal", gd.cls("ESCProjectSettingsManager").get_setting(gd.member(gd.cls("ESCProjectSettingsManager"), "MUSIC_VOLUME")));
      call(this._effects, "set_value_no_signal", gd.cls("ESCProjectSettingsManager").get_setting(gd.member(gd.cls("ESCProjectSettingsManager"), "SFX_VOLUME")));
      call(this._graphics, "select", (truthy(gd.member(gd.autoload("hd_graphics"), "hd_enabled")) ? 1 : 0));
      call(this._screen, "select", (truthy(gd.cls("ESCProjectSettingsManager").get_setting(gd.member(gd.cls("ESCProjectSettingsManager"), "FULLSCREEN"))) ? 1 : 0));
    }
    _style_popup(option) {
      let popup = call(option, "get_popup");
      call(popup, "add_theme_font_override", "font", call(option, "get_theme_font", "font"));
      call(popup, "add_theme_font_size_override", "font_size", call(option, "get_theme_font_size", "font_size"));
      call(popup, "add_theme_stylebox_override", "panel", this.get_node("%panel").get_theme_stylebox("panel"));
      call(popup, "add_theme_stylebox_override", "hover", call(option, "get_theme_stylebox", "hover"));
      call(popup, "add_theme_color_override", "font_color", call(option, "get_theme_color", "font_color"));
      call(popup, "add_theme_color_override", "font_hover_color", call(option, "get_theme_color", "font_hover_color"));
      ((__o) => { const __t = __o.min_size; __t.x = G.int(gd.member(gd.member(option, "size"), "x")); if (gd.isValue(__t)) __o.min_size = __t; return __t.x; })(popup);
    }
    _on_language_selected(index) {
      gd.cls("ESCProjectSettingsManager").set_setting(gd.member(gd.cls("ESCProjectSettingsManager"), "TEXT_LANG"), op.get(this._locales, index));
      gd.singleton("TranslationServer").set_locale(op.get(this._locales, index));
    }
    _on_music_changed(value) {
      gd.cls("ESCProjectSettingsManager").set_setting(gd.member(gd.cls("ESCProjectSettingsManager"), "MUSIC_VOLUME"), value);
      gd.member(gd.escoria, "settings_manager").apply_settings();
    }
    _on_effects_changed(value) {
      for (let setting of iter([gd.member(gd.cls("ESCProjectSettingsManager"), "SFX_VOLUME"), gd.member(gd.cls("ESCProjectSettingsManager"), "SPEECH_VOLUME"), gd.member(gd.cls("ESCProjectSettingsManager"), "AMBIENT_VOLUME")])) {
        gd.cls("ESCProjectSettingsManager").set_setting(setting, value);
      }
      gd.member(gd.escoria, "settings_manager").apply_settings();
      if (truthy(!truthy(gd.member(this._sample, "playing")))) {
        call(this._sample, "play");
      }
    }
    _on_graphics_selected(index) {
      call(gd.autoload("hd_graphics"), "set_hd", op.eq(index, 1));
    }
    _on_screen_selected(index) {
      gd.cls("ESCProjectSettingsManager").set_setting(gd.member(gd.cls("ESCProjectSettingsManager"), "FULLSCREEN"), op.eq(index, 1));
      gd.member(gd.escoria, "settings_manager").apply_settings();
    }
    _on_back_pressed() {
      gd.member(gd.escoria, "settings_manager").save_settings();
      call(this.signal("back_button_pressed"), "emit");
    }
  }
  Object.assign(openquest_options, { LANGUAGE_NAMES, EFFECTS_SAMPLE });
  return openquest_options;
}
