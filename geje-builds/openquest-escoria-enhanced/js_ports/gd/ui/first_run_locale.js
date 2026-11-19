// Translated from res://ui/first_run_locale.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const TEXT_LANG = "escoria/main/text_lang";
  class first_run_locale extends gd.base("Node") {
    constructor(...args) {
      super(...args);
    }
    _ready() {
      let folder = gd.singleton("ProjectSettings").get_setting("escoria/main/settings_path");
      if (truthy(gd.cls("FileAccess").file_exists(call(folder, "path_join", "settings.tres")))) {
        return;
      }
      let lang = gd.singleton("OS").get_locale_language();
      if (truthy(op.in(lang, gd.singleton("TranslationServer").get_loaded_locales()))) {
        gd.singleton("ProjectSettings").set_setting(TEXT_LANG, lang);
        gd.singleton("TranslationServer").set_locale(lang);
      }
    }
  }
  Object.assign(first_run_locale, { TEXT_LANG });
  return first_run_locale;
}
