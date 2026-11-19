// Translated from res://game/ui/phone/phone_menu.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const IMG = "res://game/images/interface/";
  const FONT = gd.preload("res://game/fonts/PTN77F.ttf");
  const LIGHT_FONT = gd.preload("res://game/fonts/PTN57F.ttf");
  const INFO_FONT = gd.preload("res://game/fonts/DejaVuSansMono.ttf");
  const WORLD = G.Vector2(1920, 1080);
  const MENU_MARGIN = 90;
  const MENU_SMALL_MARGIN = 35;
  const OKNOTOK_Y = 858;
  const OK_X = 120;
  const NOTOK_X = 360;
  const EXIT_MENU_LOGO = 130;
  const EXIT_MENU_START = 220;
  const EXIT_MENU_TEXT = op.add(MENU_MARGIN, 60);
  const SETTINGS_MARGIN = 15;
  const SETTINGS_START = 135;
  const SETTINGS_HEIGHT = 100;
  const SETTINGS_IN_MARGIN = 20;
  const SETTINGS_VALUE_MARGIN = 75;
  const LARROW_X = op.add(SETTINGS_MARGIN, 370);
  const RARROW_X = op.add(SETTINGS_MARGIN, 420);
  const PHONE_SCRIPT = "res://game/items/inventory/phone.ash";
  const PHONE_BOOK = [["Hint Hotline", "04.65.71.19.45", "call_hints"], ["Harpagon Lonion", "06.39.98.07.55", "call_harpagon"]];
  const TEXTS = { "wanna_quit": "Exit the game?\n", "wanna_restart": "Your progress will be\nlost.\n\nDo you want to start\nover?\n", "wanna_save": "The previous save point\nwill be overwritten.\n\nConfirm?\n", "saved": "Game saved!\n", "wanna_load": "Your progress will be\nlost.\n\nConfirm?\n", "no_phone_allowed": "You cannot make a\ncall at the moment.\n", "no_savegame": "No saved game\navailable.\n", "controls_mouse": "ESCAPE:\n  - while playing, access the menu\n\nRIGHT CLICK/SPACE:\n  - skip a line of dialogue\n" };
  const TEXT_SPEEDS = [["slow", (18.0 / 12.0)], ["medium", 1.0], ["fast", (9.0 / 12.0)]];
  const LANGUAGES = [["en", "English (US)"], ["es", "Español"], ["fr", "Français (France)"], ["de", "Deutsch"], ["it", "Italiano (Italia)"], ["pt", "Português (Brasil)"]];
  const SAVE_SLOTS = 5;
  class phone_menu extends gd.base("Control") {
    constructor(...args) {
      super(...args);
      this.__field("mode", this.__export("mode", "pause"));
      this.__field("_phone", null);
      this.__field("_page", null);
      this.__field("_ref", new gd.Vector2());
      this.__field("_shown_frame", -1);
    }
    _ready() {
      this.process_mode = gd.member(gd.cls("Node"), "PROCESS_MODE_ALWAYS");
      this.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_STOP");
      this.size = WORLD;
      let overlay = gd.new_("ColorRect", []);
      overlay.color = (truthy(op.eq(this.mode, "pause")) ? G.Color(0, 0, 0, (64.0 / 255.0)) : gd.member(gd.cls("Color"), "BLACK"));
      overlay.size = WORLD;
      overlay.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      this.add_child(overlay);
      this._phone = gd.new_("TextureRect", []);
      this._phone.texture = G.load(op.add(IMG, "menu.png"));
      this._phone.size = call(gd.member(this._phone, "texture"), "get_size");
      this._phone.position = call((op.div((op.sub(WORLD, gd.member(this._phone, "size"))), 2)), "round");
      this._phone.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      this.add_child(this._phone);
      this._ref = op.add(op.div(WORLD, 2), G.Vector2(-240, -420));
      let info = gd.new_("Label", []);
      info.text = "Superfluous Returnz (demo)";
      call(info, "add_theme_font_override", "font", INFO_FONT);
      call(info, "add_theme_font_size_override", "font_size", 20);
      info.size = G.Vector2(600, 30);
      info.position = op.sub(op.sub(WORLD, gd.member(info, "size")), G.Vector2(5, 5));
      info.horizontal_alignment = G.HORIZONTAL_ALIGNMENT_RIGHT;
      this.add_child(info);
      call(gd.member(this, "visibility_changed"), "connect", (() => { return this._shown_frame = gd.singleton("Engine").get_process_frames(); }));
      this.hide();
    }
    reset() {
      this._show_main();
    }
    set_save_enabled(_enabled) {

    }
    _new_page() {
      if (truthy(this._page)) {
        call(this._page, "queue_free");
      }
      this._page = gd.new_("Control", []);
      this._page.size = WORLD;
      this._page.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      this.add_child(this._page);
      return this._page;
    }
    _main_items() {
      if (truthy(op.eq(this.mode, "main"))) {
        return [["new_game", "New game", "nouvelle_partie"], ["load", "Load", "load"], ["settings", "Settings", "preferences"], ["controls", "Controls", "credits"], ["quit", "Quit", "quitter"]];
      }
      let items = [["phone", "Phone", "telephone"], ["settings", "Settings", "preferences"], ["controls", "Controls", "credits"], ["new_game", "New game", "nouvelle_partie"], ["load", "Load", "load"]];
      if (truthy(gd.member(gd.member(gd.escoria, "save_manager"), "save_enabled"))) {
        call(items, "append", ["save", "Save", "save"]);
      }
      call(items, "append", ["quit", "Quit", "quitter"]);
      return items;
    }
    _show_main() {
      this._new_page();
      this._image(op.add(IMG, "menu_logo.png"), op.add(this._ref, G.Vector2(240, EXIT_MENU_LOGO)));
      let items = this._main_items();
      let y = G.float(EXIT_MENU_START);
      for (let it of iter(items)) {
        let b = this._button(op.add(IMG, "menu_bouton.png"), op.add(this._ref, G.Vector2(240, y)), call(gd.Callable(this, "_on_main_item"), "bind", op.get(it, 0)));
        this._image(op.add(op.add(IMG, op.get(it, 2)), ".png"), op.add(this._ref, G.Vector2(MENU_MARGIN, y)));
        this._text(this.tr(op.get(it, 1)), FONT, 40, op.add(this._ref, G.Vector2(EXIT_MENU_TEXT, y)), G.Vector2(0, 0.5));
        y = op.add(y, op.mul(MENU_MARGIN, (op.div(7.0, call(items, "size")))));
      }
      if (truthy(op.eq(this.mode, "pause"))) {
        this._ok_alone(gd.Callable(this, "_close"));
      }
    }
    _on_main_item(id) {
      {
        const __m1 = id;
        if (op.eq(__m1, "phone")) {
          this._show_phone_book();
        }
        else if (op.eq(__m1, "settings")) {
          this._show_settings();
        }
        else if (op.eq(__m1, "controls")) {
          this._show_text("Controls", op.get(TEXTS, "controls_mouse"), gd.Callable(this, "_show_main"));
        }
        else if (op.eq(__m1, "new_game")) {
          if (truthy(op.eq(this.mode, "main"))) {
            gd.escoria.new_game();
          } else {
            this._confirm("New game", op.get(TEXTS, "wanna_restart"), (() => {
      this._close();
      gd.escoria.new_game();
    }));
          }
        }
        else if (op.eq(__m1, "load")) {
          this._show_load();
        }
        else if (op.eq(__m1, "save")) {
          this._show_save();
        }
        else if (op.eq(__m1, "quit")) {
          if (truthy(op.eq(this.mode, "main"))) {
            gd.escoria.quit();
          } else {
            this._confirm("Quit", op.get(TEXTS, "wanna_quit"), (() => { return gd.escoria.quit(); }));
          }
        }
      }
    }
    _show_phone_book() {
      if (truthy(!truthy(this._can_call()))) {
        this._show_text("Phone", op.get(TEXTS, "no_phone_allowed"), gd.Callable(this, "_show_main"));
        return;
      }
      this._new_page();
      this._title("Phone");
      let y = G.float(SETTINGS_START);
      for (let entry of iter(PHONE_BOOK)) {
        this._list_entry(y, this.tr(op.get(entry, 0)), op.get(entry, 1), call(gd.Callable(this, "_call"), "bind", op.get(entry, 2)));
        y = op.add(y, SETTINGS_HEIGHT);
      }
      this._ok_alone(gd.Callable(this, "_show_main"));
    }
    _can_call() {
      return (truthy((truthy(op.eq(this.mode, "pause")) && truthy(op.ne(gd.member(gd.member(gd.escoria, "main"), "current_scene"), null)))) && truthy(gd.member(gd.escoria, "object_manager").has("sophie")));
    }
    _call(event_name) {
      this._close();
      let script = gd.member(gd.escoria, "esc_compiler").load_esc_file(PHONE_SCRIPT);
      gd.member(gd.escoria, "event_manager").queue_event_from_esc(script, event_name, "_front", false);
    }
    _show_save() {
      this._new_page();
      this._title("Save");
      let saves = gd.member(gd.escoria, "save_manager").get_saves_list();
      let y = G.float(SETTINGS_START);
      for (let slot of iter(G.range(1, op.add(SAVE_SLOTS, 1)))) {
        let title = op.mod("%d. ", slot);
        let info = this.tr("(Free slot)");
        if (truthy(call(saves, "has", slot))) {
          title = op.add(title, this.tr(op.get(op.get(saves, slot), "name")));
          info = this._date(op.get(op.get(saves, slot), "date"));
        }
        this._list_entry(y, title, info, call(gd.Callable(this, "_on_save_slot"), "bind", slot, call(saves, "has", slot)));
        y = op.add(y, op.add(SETTINGS_HEIGHT, SETTINGS_MARGIN));
      }
      this._ok_alone(gd.Callable(this, "_show_main"));
    }
    _on_save_slot(slot, exists) {
      let do_save = (() => {
      gd.member(gd.escoria, "save_manager").save_game(slot, this._room_name());
      this._show_text("Save", op.get(TEXTS, "saved"), gd.Callable(this, "_show_main"));
    });
      if (truthy(exists)) {
        this._confirm("Save", op.get(TEXTS, "wanna_save"), do_save, gd.Callable(this, "_show_save"));
      } else {
        call(do_save, "call");
      }
    }
    _show_load() {
      this._new_page();
      this._title("Load");
      let saves = gd.member(gd.escoria, "save_manager").get_saves_list();
      if (truthy(call(saves, "is_empty"))) {
        this._lines(op.get(TEXTS, "no_savegame"));
      }
      let y = G.float(SETTINGS_START);
      let slots = call(saves, "keys");
      call(slots, "sort");
      for (let slot of iter(slots)) {
        this._list_entry(y, op.mod("%d. %s", [slot, this.tr(op.get(op.get(saves, slot), "name"))]), this._date(op.get(op.get(saves, slot), "date")), call(gd.Callable(this, "_on_load_slot"), "bind", slot));
        y = op.add(y, op.add(SETTINGS_HEIGHT, SETTINGS_MARGIN));
      }
      this._ok_alone(gd.Callable(this, "_show_main"));
    }
    _on_load_slot(slot) {
      let do_load = (() => {
      this._close();
      gd.member(gd.escoria, "save_manager").load_game(slot);
    });
      if (truthy(op.eq(this.mode, "pause"))) {
        this._confirm("Load", op.get(TEXTS, "wanna_load"), do_load, gd.Callable(this, "_show_load"));
      } else {
        call(do_load, "call");
      }
    }
    _show_settings() {
      this._new_page();
      this._title("Settings");
      let y = G.float(SETTINGS_START);
      let settings = [["Language", op.get(op.get(LANGUAGES, this._language_index()), 1), call(gd.Callable(this, "_change_language"), "bind", -1), call(gd.Callable(this, "_change_language"), "bind", 1)], ["Full screen", this._fullscreen_text(), gd.Callable(this, "_toggle_fullscreen"), gd.Callable(this, "_toggle_fullscreen")], ["Dialogue speed", this.tr(op.get(op.get(TEXT_SPEEDS, this._text_speed_index()), 0)), call(gd.Callable(this, "_change_text_speed"), "bind", -1), call(gd.Callable(this, "_change_text_speed"), "bind", 1)], ["Music volume", this._volume_text(gd.member(gd.cls("ESCProjectSettingsManager"), "MUSIC_VOLUME")), call(gd.Callable(this, "_change_volume"), "bind", gd.member(gd.cls("ESCProjectSettingsManager"), "MUSIC_VOLUME"), -0.1), call(gd.Callable(this, "_change_volume"), "bind", gd.member(gd.cls("ESCProjectSettingsManager"), "MUSIC_VOLUME"), 0.1)], ["Sound effects volume", this._volume_text(gd.member(gd.cls("ESCProjectSettingsManager"), "SFX_VOLUME")), call(gd.Callable(this, "_change_volume"), "bind", gd.member(gd.cls("ESCProjectSettingsManager"), "SFX_VOLUME"), -0.1), call(gd.Callable(this, "_change_volume"), "bind", gd.member(gd.cls("ESCProjectSettingsManager"), "SFX_VOLUME"), 0.1)]];
      for (let s of iter(settings)) {
        this._image(op.add(IMG, "menu_bouton_preferences.png"), op.add(this._ref, G.Vector2(240, op.add(y, op.div(SETTINGS_HEIGHT, 2.0)))));
        this._text(this.tr(op.get(s, 0)), FONT, 40, op.add(this._ref, G.Vector2(op.add(SETTINGS_MARGIN, SETTINGS_IN_MARGIN), op.add(op.add(y, SETTINGS_IN_MARGIN), SETTINGS_MARGIN))), G.Vector2(0, 0.5), 415);
        this._text(op.get(s, 1), LIGHT_FONT, 36, op.add(this._ref, G.Vector2(op.add(SETTINGS_MARGIN, SETTINGS_IN_MARGIN), op.add(y, SETTINGS_VALUE_MARGIN))), G.Vector2(0, 0.5));
        this._button(op.add(IMG, "gauche_menu.png"), op.add(this._ref, G.Vector2(LARROW_X, op.add(y, SETTINGS_VALUE_MARGIN))), op.get(s, 2), true);
        this._button(op.add(IMG, "droite_menu.png"), op.add(this._ref, G.Vector2(RARROW_X, op.add(y, SETTINGS_VALUE_MARGIN))), op.get(s, 3), true);
        y = op.add(y, op.add(SETTINGS_HEIGHT, SETTINGS_MARGIN));
      }
      this._ok_alone((() => {
      gd.member(gd.escoria, "settings_manager").save_settings();
      this._show_main();
    }));
    }
    _language_index() {
      let locale = gd.singleton("TranslationServer").get_locale();
      for (let i of iter(call(LANGUAGES, "size"))) {
        if (truthy(call(locale, "begins_with", op.get(op.get(LANGUAGES, i), 0)))) {
          return i;
        }
      }
      return 0;
    }
    _change_language(delta) {
      let i = G.wrapi(op.add(this._language_index(), delta), 0, call(LANGUAGES, "size"));
      gd.singleton("TranslationServer").set_locale(op.get(op.get(LANGUAGES, i), 0));
      gd.cls("ESCProjectSettingsManager").set_setting(gd.member(gd.cls("ESCProjectSettingsManager"), "TEXT_LANG"), op.get(op.get(LANGUAGES, i), 0));
      this._show_settings();
    }
    _fullscreen_text() {
      let fs = op.in(gd.singleton("DisplayServer").window_get_mode(), [gd.member(gd.singleton("DisplayServer"), "WINDOW_MODE_FULLSCREEN"), gd.member(gd.singleton("DisplayServer"), "WINDOW_MODE_EXCLUSIVE_FULLSCREEN")]);
      return (truthy(fs) ? this.tr("yes") : this.tr("no"));
    }
    _toggle_fullscreen() {
      let fs = op.in(gd.singleton("DisplayServer").window_get_mode(), [gd.member(gd.singleton("DisplayServer"), "WINDOW_MODE_FULLSCREEN"), gd.member(gd.singleton("DisplayServer"), "WINDOW_MODE_EXCLUSIVE_FULLSCREEN")]);
      gd.cls("ESCProjectSettingsManager").set_setting(gd.member(gd.cls("ESCProjectSettingsManager"), "FULLSCREEN"), !truthy(fs));
      gd.member(gd.escoria, "settings_manager").apply_settings();
      this._show_settings();
    }
    _volume_text(setting) {
      return op.mod("%d %%", G.int(G.round(op.mul(gd.cls("ESCProjectSettingsManager").get_setting(setting), 100))));
    }
    _change_volume(setting, delta) {
      let v = G.clamp(op.add(gd.cls("ESCProjectSettingsManager").get_setting(setting), delta), 0.0, 1.0);
      gd.cls("ESCProjectSettingsManager").set_setting(setting, G.snappedf(v, 0.1));
      gd.member(gd.escoria, "settings_manager").apply_settings();
      this._show_settings();
    }
    _text_speed_index() {
      let factor = gd.member(gd.escoria, "settings_manager").get_custom_setting("text_speed", 1.0);
      for (let i of iter(call(TEXT_SPEEDS, "size"))) {
        if (truthy(G.is_equal_approx(op.get(op.get(TEXT_SPEEDS, i), 1), factor))) {
          return i;
        }
      }
      return 1;
    }
    _change_text_speed(delta) {
      let i = G.clampi(op.add(this._text_speed_index(), delta), 0, op.sub(call(TEXT_SPEEDS, "size"), 1));
      ((__o) => { const __t = __o.custom_settings; op.set(__t, "text_speed", op.get(op.get(TEXT_SPEEDS, i), 1)); if (gd.isValue(__t)) __o.custom_settings = __t; return op.get(__t, "text_speed"); })(gd.member(gd.escoria, "settings_manager"));
      this._show_settings();
    }
    _show_text(title, text, on_ok) {
      this._new_page();
      this._title(title);
      this._lines(text);
      this._ok_alone(on_ok);
    }
    _confirm(title, text, on_ok, on_cancel = gd.Callable(this, "_show_main")) {
      this._new_page();
      this._title(title);
      this._lines(text);
      this._button_box(G.Vector2(230, 50), op.add(this._ref, G.Vector2(OK_X, OKNOTOK_Y)), on_ok);
      this._image(op.add(IMG, "ok.png"), op.add(this._ref, G.Vector2(OK_X, OKNOTOK_Y)));
      this._button_box(G.Vector2(230, 50), op.add(this._ref, G.Vector2(NOTOK_X, OKNOTOK_Y)), on_cancel);
      this._image(op.add(IMG, "annuler.png"), op.add(this._ref, G.Vector2(NOTOK_X, OKNOTOK_Y)));
    }
    _title(text) {
      this._text(this.tr(text), FONT, 60, op.add(this._ref, G.Vector2(240, MENU_MARGIN)), G.Vector2(0.5, 0.5));
    }
    _lines(text) {
      let y = G.float(EXIT_MENU_START);
      for (let line of iter(call(this.tr(text), "split", "\n"))) {
        this._text(line, LIGHT_FONT, 40, op.add(this._ref, G.Vector2(MENU_SMALL_MARGIN, y)), G.Vector2(0, 0));
        y = op.add(y, MENU_SMALL_MARGIN);
      }
    }
    _list_entry(y, title, subtitle, callback) {
      this._button(op.add(IMG, "menu_bouton_preferences.png"), op.add(this._ref, G.Vector2(240, op.add(y, op.div(SETTINGS_HEIGHT, 2.0)))), callback);
      this._text(title, FONT, 40, op.add(this._ref, G.Vector2(op.add(SETTINGS_MARGIN, SETTINGS_IN_MARGIN), op.add(op.add(y, SETTINGS_IN_MARGIN), SETTINGS_MARGIN))), G.Vector2(0, 0.5), 415);
      this._text(subtitle, LIGHT_FONT, 36, op.add(this._ref, G.Vector2(op.add(SETTINGS_MARGIN, SETTINGS_IN_MARGIN), op.add(y, SETTINGS_VALUE_MARGIN))), G.Vector2(0, 0.5), 415);
    }
    _ok_alone(callback) {
      this._button_box(G.Vector2(460, 50), op.add(this._ref, G.Vector2(240, OKNOTOK_Y)), callback);
      this._image(op.add(IMG, "ok.png"), op.add(this._ref, G.Vector2(240, OKNOTOK_Y)));
    }
    _image(path, center) {
      let t = gd.new_("TextureRect", []);
      t.texture = G.load(path);
      t.size = call(gd.member(t, "texture"), "get_size");
      t.position = call((op.sub(center, op.div(gd.member(t, "size"), 2))), "round");
      t.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      call(this._page, "add_child", t);
      return t;
    }
    _text(text, font, font_size, point, anchor, max_width = 0.0) {
      let l = gd.new_("Label", []);
      l.text = text;
      call(l, "add_theme_font_override", "font", font);
      let w = gd.member(call(font, "get_string_size", text, G.HORIZONTAL_ALIGNMENT_LEFT, -1, font_size), "x");
      if (truthy((truthy((max_width > 0)) && truthy((w > max_width))))) {
        font_size = G.int(op.div(op.mul(font_size, max_width), w));
        w = max_width;
      }
      call(l, "add_theme_font_size_override", "font_size", font_size);
      call(l, "add_theme_color_override", "font_color", gd.member(gd.cls("Color"), "WHITE"));
      l.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      let h = call(font, "get_height", font_size);
      l.size = G.Vector2(w, h);
      l.position = call((op.sub(point, op.mul(G.Vector2(w, h), anchor))), "round");
      call(this._page, "add_child", l);
      return l;
    }
    _button(path, center, callback, small = false) {
      let b = gd.new_("TextureButton", []);
      b.texture_normal = G.load(path);
      b.size = call(gd.member(b, "texture_normal"), "get_size");
      b.position = call((op.sub(center, op.div(gd.member(b, "size"), 2))), "round");
      call(gd.member(b, "mouse_entered"), "connect", (() => { return b.modulate = G.Color(1.6, 1.6, 1.6); }));
      call(gd.member(b, "mouse_exited"), "connect", (() => { return b.modulate = gd.member(gd.cls("Color"), "WHITE"); }));
      call(gd.member(b, "pressed"), "connect", callback);
      call(this._page, "add_child", b);
      return b;
    }
    _button_box(box, center, callback) {
      let b = gd.new_("Button", []);
      b.flat = true;
      b.size = box;
      b.position = call((op.sub(center, op.div(box, 2))), "round");
      let normal = gd.new_("StyleBoxFlat", []);
      normal.bg_color = G.Color(0, 0, 0, (64.0 / 255.0));
      let hover = gd.new_("StyleBoxFlat", []);
      hover.bg_color = G.Color(1, 1, 1, (64.0 / 255.0));
      call(b, "add_theme_stylebox_override", "normal", normal);
      call(b, "add_theme_stylebox_override", "hover", hover);
      call(b, "add_theme_stylebox_override", "pressed", hover);
      call(b, "add_theme_stylebox_override", "focus", gd.new_("StyleBoxEmpty", []));
      call(gd.member(b, "pressed"), "connect", callback);
      call(this._page, "add_child", b);
    }
    _close() {
      if (truthy(op.eq(this.mode, "pause"))) {
        gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "game").unpause_game();
      } else {
        this.hide();
      }
    }
    _date(d) {
      return op.mod("%02d/%02d/%04d %02d:%02d", [op.get(d, "day"), op.get(d, "month"), op.get(d, "year"), op.get(d, "hour"), op.get(d, "minute")]);
    }
    _room_name() {
      let gid = (truthy(gd.member(gd.member(gd.escoria, "main"), "current_scene")) ? gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "global_id") : "");
      {
        const __m1 = gid;
        if (op.eq(__m1, "room_desk")) {
          return "Office";
        }
        else if (op.eq(__m1, "room_flug")) {
          return "Fluouscave";
        }
      }
      return gid;
    }
    _unhandled_input(event) {
      if (truthy((truthy((truthy((truthy(gd.member(this, "visible")) && truthy(op.eq(this.mode, "pause")))) && truthy(call(event, "is_action_pressed", "ui_cancel")))) && truthy((gd.singleton("Engine").get_process_frames() > this._shown_frame))))) {
        call(this.get_viewport(), "set_input_as_handled");
        this._close();
      }
    }
  }
  Object.assign(phone_menu, { IMG, FONT, LIGHT_FONT, INFO_FONT, WORLD, MENU_MARGIN, MENU_SMALL_MARGIN, OKNOTOK_Y, OK_X, NOTOK_X, EXIT_MENU_LOGO, EXIT_MENU_START, EXIT_MENU_TEXT, SETTINGS_MARGIN, SETTINGS_START, SETTINGS_HEIGHT, SETTINGS_IN_MARGIN, SETTINGS_VALUE_MARGIN, LARROW_X, RARROW_X, PHONE_SCRIPT, PHONE_BOOK, TEXTS, TEXT_SPEEDS, LANGUAGES, SAVE_SLOTS });
  return phone_menu;
}
