// Translated from res://graphics/hd_graphics.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const HD_ROOT = "res://hd/";
  const CONFIG_PATH = "user://graficos.cfg";
  const TOGGLE_KEY = G.KEY_F10;
  const BANGERS = "res://hd/fonts/Bangers-Regular.ttf";
  const NUNITO_BOLD = "res://hd/fonts/Nunito-Bold.tres";
  const NUNITO_BOLD_SPEECH = "res://hd/fonts/Nunito-Bold-hablado.tres";
  const FONT_MAP = { "res://fonts/chtest.fnt": { "font": NUNITO_BOLD_SPEECH, "scale": 0.4844, "outline": 17, "outline_color": G.Color(0.141, 0.122, 0.192), "line_sep": -10 }, "res://fonts/dialog_charset.fnt": { "font": NUNITO_BOLD, "scale": 0.875 }, "res://fonts/verb_chset.fnt": { "font": BANGERS, "scale": 1.0 } };
  const FONT_SLOTS = { "font": "font_size", "normal_font": "normal_font_size", "bold_font": "bold_font_size", "italics_font": "italics_font_size" };
  const OUTLINE_TYPES = ["RichTextLabel", "Label"];
  const LINE_SEP_CONST = { "RichTextLabel": "line_separation", "Label": "line_spacing" };
  const ARROW_ICONS = { "\u0003": "res://hd/ui/arrow_up.png", "\u0002": "res://hd/ui/arrow_down.png" };
  const ARROW_ICON_WIDTH = 28;
  const HD_MARGIN = { "res://hd/characters/ensign_zob/frames/": 64, "res://hd/characters/commander_zif/frames/": 64, "res://hd/characters/cube_actor/frames/": 64, "res://hd/characters/bluecup_actor/frames/": 64, "res://hd/characters/ufo_actor/frames/": 64 };
  const HD_DIALOG_COLORS = { "res://characters/ensign_zob/ensign_zob.tscn": G.Color(0.965, 0.38, 0.318) };
  const STYLE_SLOTS = ["normal", "hover", "pressed", "focus", "disabled", "hover_pressed", "panel"];
  class hd_graphics extends gd.base("Node") {
    constructor(...args) {
      super(...args);
      this.__field("hd_enabled", true);
      this.__field("_exists_cache", {  });
    }
    _ready() {
      let cfg = gd.new_("ConfigFile", []);
      if (truthy(op.eq(call(cfg, "load", CONFIG_PATH), G.OK))) {
        this.hd_enabled = call(cfg, "get_value", "graficos", "hd", this.hd_enabled);
      }
      call(gd.member(this.get_tree(), "node_added"), "connect", gd.Callable(this, "_apply_node"));
      call(gd.Callable(this, "_apply_tree"), "call_deferred", gd.member(this.get_tree(), "root"));
    }
    _input(event) {
      if (truthy((truthy((truthy((truthy(gd.is(event, "InputEventKey")) && truthy(gd.member(event, "pressed")))) && truthy(!truthy(gd.member(event, "echo"))))) && truthy(op.eq(gd.member(event, "keycode"), TOGGLE_KEY))))) {
        this.set_hd(!truthy(this.hd_enabled));
        call(this.get_viewport(), "set_input_as_handled");
      }
    }
    set_hd(enabled) {
      this.hd_enabled = enabled;
      let cfg = gd.new_("ConfigFile", []);
      call(cfg, "load", CONFIG_PATH);
      call(cfg, "set_value", "graficos", "hd", this.hd_enabled);
      call(cfg, "save", CONFIG_PATH);
      this._apply_tree(gd.member(this.get_tree(), "root"));
    }
    _apply_tree(node) {
      if (truthy(gd.is(node, "Control"))) {
        this._apply_control(node);
      } else {
        this._apply_node(node);
      }
      for (let child of iter(call(node, "get_children"))) {
        this._apply_tree(child);
      }
    }
    _apply_node(node) {
      if (truthy(call(HD_DIALOG_COLORS, "has", gd.member(node, "scene_file_path")))) {
        this._apply_dialog_color(node);
      }
      if (truthy(gd.is(node, "Sprite2D"))) {
        this._apply_sprite(node);
      } else if (truthy(gd.is(node, "AnimatedSprite2D"))) {
        this._apply_animated_sprite(node);
      } else if (truthy(gd.is(node, "AnimationPlayer"))) {
        this._apply_animations(node);
      } else if (truthy(gd.is(node, "Control"))) {
        call(gd.Callable(this, "_apply_control"), "call_deferred", node);
      } else if (truthy(op.ne(call(node, "get", "inventory_texture"), null))) {
        this._apply_item(node);
      }
    }
    _apply_dialog_color(item) {
      if (truthy(!truthy(call(item, "has_meta", "hd_dialog_color")))) {
        call(item, "set_meta", "hd_dialog_color", call(item, "get", "dialog_color"));
      }
      call(item, "set", "dialog_color", (truthy(this.hd_enabled) ? op.get(HD_DIALOG_COLORS, gd.member(item, "scene_file_path")) : call(item, "get_meta", "hd_dialog_color")));
    }
    _apply_item(item) {
      for (let prop of iter(["inventory_texture", "inventory_texture_hovered"])) {
        let tex = call(item, "get", prop);
        if (truthy(gd.is(tex, "Texture2D"))) {
          let t = this._target(tex);
          if (truthy(op.ne(t, tex))) {
            call(item, "set", prop, t);
          }
        }
      }
    }
    _apply_texture_control(control) {
      for (let prop of iter(["texture", "texture_normal", "texture_hover", "texture_pressed", "texture_focused"])) {
        let tex = call(control, "get", prop);
        if (truthy(gd.is(tex, "Texture2D"))) {
          let t = this._target(tex);
          if (truthy(op.ne(t, tex))) {
            call(control, "set", prop, t);
          }
        }
      }
    }
    _apply_styleboxes(control) {
      for (let slot of iter(STYLE_SLOTS)) {
        if (truthy(!truthy(call(control, "has_theme_stylebox_override", slot)))) {
          continue;
        }
        let sb = call(control, "get_theme_stylebox", slot);
        if (truthy(gd.is(sb, "StyleBoxTexture"))) {
          let t = this._target(gd.member(sb, "texture"));
          if (truthy(op.ne(t, gd.member(sb, "texture")))) {
            sb.texture = t;
          }
        }
      }
    }
    _apply_arrow(button) {
      let glyph = call(button, "get_meta", "hd_arrow", gd.member(button, "text"));
      if (truthy(!truthy(call(ARROW_ICONS, "has", glyph)))) {
        return;
      }
      call(button, "set_meta", "hd_arrow", glyph);
      if (truthy(this.hd_enabled)) {
        button.text = "";
        button.icon = G.load(op.get(ARROW_ICONS, glyph));
        button.icon_alignment = gd.member(button, "alignment");
        call(button, "add_theme_constant_override", "icon_max_width", ARROW_ICON_WIDTH);
        for (let pair of iter([["icon_normal_color", "font_color"], ["icon_hover_color", "font_hover_color"], ["icon_pressed_color", "font_pressed_color"], ["icon_hover_pressed_color", "font_hover_pressed_color"], ["icon_focus_color", "font_focus_color"]])) {
          call(button, "add_theme_color_override", op.get(pair, 0), call(button, "get_theme_color", op.get(pair, 1)));
        }
      } else {
        button.icon = null;
        button.text = glyph;
      }
    }
    _original_path(path) {
      if (truthy(call(path, "begins_with", HD_ROOT))) {
        return op.add("res://", call(path, "substr", call(HD_ROOT, "length")));
      }
      return path;
    }
    _exists(path) {
      if (truthy(!truthy(call(this._exists_cache, "has", path)))) {
        op.set(this._exists_cache, path, gd.singleton("ResourceLoader").exists(path));
      }
      return op.get(this._exists_cache, path);
    }
    _target(tex) {
      if (truthy((truthy(op.eq(tex, null)) || truthy(op.eq(gd.member(tex, "resource_path"), ""))))) {
        return tex;
      }
      let orig = this._original_path(gd.member(tex, "resource_path"));
      let want = (truthy(this.hd_enabled) ? (op.add(HD_ROOT, call(orig, "substr", call("res://", "length")))) : orig);
      if (truthy((truthy(op.eq(want, gd.member(tex, "resource_path"))) || truthy(!truthy(this._exists(want)))))) {
        return tex;
      }
      return G.load(want);
    }
    _margin(tex) {
      if (truthy(op.eq(tex, null))) {
        return 0;
      }
      return call(HD_MARGIN, "get", op.add(call(gd.member(tex, "resource_path"), "get_base_dir"), "/"), 0);
    }
    _factor(tex) {
      if (truthy((truthy(op.eq(tex, null)) || truthy(!truthy(call(gd.member(tex, "resource_path"), "begins_with", HD_ROOT)))))) {
        return 1.0;
      }
      let orig_path = this._original_path(gd.member(tex, "resource_path"));
      if (truthy(!truthy(this._exists(orig_path)))) {
        return 1.0;
      }
      let orig = G.load(orig_path);
      return op.div(G.float(op.sub(call(tex, "get_width"), op.mul(2, this._margin(tex)))), G.float(call(orig, "get_width")));
    }
    _base(node) {
      if (truthy(!truthy(call(node, "has_meta", "hd_base")))) {
        let base = { "scale": gd.member(node, "scale"), "offset": call(node, "get", "offset"), "filter": gd.member(node, "texture_filter") };
        if (truthy(gd.is(node, "Sprite2D"))) {
          op.set(base, "region", gd.member(node, "region_rect"));
        }
        call(node, "set_meta", "hd_base", base);
      }
      return call(node, "get_meta", "hd_base");
    }
    _fit(node, factor, is_hd, margin = 0) {
      let base = this._base(node);
      node.scale = op.div(op.get(base, "scale"), factor);
      let shift = (truthy(call(node, "get", "centered")) ? gd.member(gd.cls("Vector2"), "ZERO") : G.Vector2(margin, margin));
      call(node, "set", "offset", op.sub(op.mul(op.get(base, "offset"), factor), shift));
      if (truthy((truthy(gd.is(node, "Sprite2D")) && truthy(gd.member(node, "region_enabled"))))) {
        let r = op.get(base, "region");
        node.region_rect = G.Rect2(op.mul(gd.member(r, "position"), factor), op.mul(gd.member(r, "size"), factor));
      }
      if (truthy(!truthy(is_hd))) {
        node.texture_filter = op.get(base, "filter");
      } else if (truthy((factor > 1.0))) {
        node.texture_filter = gd.member(gd.cls("CanvasItem"), "TEXTURE_FILTER_LINEAR_WITH_MIPMAPS");
      } else {
        node.texture_filter = gd.member(gd.cls("CanvasItem"), "TEXTURE_FILTER_LINEAR");
      }
    }
    _apply_sprite(sprite) {
      let tex = this._target(gd.member(sprite, "texture"));
      if (truthy(op.eq(tex, null))) {
        return;
      }
      this._base(sprite);
      sprite.texture = tex;
      this._fit(sprite, this._factor(tex), call(gd.member(tex, "resource_path"), "begins_with", HD_ROOT), this._margin(tex));
    }
    _apply_animated_sprite(sprite) {
      let frames = gd.member(sprite, "sprite_frames");
      if (truthy(op.eq(frames, null))) {
        return;
      }
      this._base(sprite);
      let sample = null;
      let missing = 0;
      for (let anim of iter(call(frames, "get_animation_names"))) {
        for (let i of iter(call(frames, "get_frame_count", anim))) {
          let tex = this._target(call(frames, "get_frame_texture", anim, i));
          if (truthy(op.ne(tex, call(frames, "get_frame_texture", anim, i)))) {
            call(frames, "set_frame", anim, i, tex, call(frames, "get_frame_duration", anim, i));
          }
          if (truthy(op.eq(tex, null))) {
            continue;
          }
          if (truthy(call(gd.member(tex, "resource_path"), "begins_with", HD_ROOT))) {
            if (truthy((truthy(op.eq(sample, null)) || truthy(!truthy(call(gd.member(sample, "resource_path"), "begins_with", HD_ROOT)))))) {
              sample = tex;
            }
          } else {
            missing = op.add(missing, 1);
            if (truthy(op.eq(sample, null))) {
              sample = tex;
            }
          }
        }
      }
      if (truthy(op.ne(sample, null))) {
        let is_hd = call(gd.member(sample, "resource_path"), "begins_with", HD_ROOT);
        if (truthy((truthy(is_hd) && truthy((missing > 0))))) {
          G.push_warning(op.mod("hd_graphics: %s tiene %d cuadros sin version HD", [gd.member(call(sprite, "get_parent"), "name"), missing]));
        }
        this._fit(sprite, this._factor(sample), is_hd, this._margin(sample));
      }
    }
    _hd_font(original) {
      if (truthy((truthy(op.eq(original, null)) || truthy(!truthy(call(FONT_MAP, "has", gd.member(original, "resource_path"))))))) {
        return {  };
      }
      return op.get(FONT_MAP, gd.member(original, "resource_path"));
    }
    _native_size(font) {
      let size = call(font, "get", "fixed_size");
      return (truthy((truthy(gd.is(size, "int")) && truthy((size > 0)))) ? size : 40);
    }
    _text_fits(control, font) {
      let text = call(control, "get", "text");
      if (truthy(!truthy(gd.is(text, "String")))) {
        return true;
      }
      for (let c of iter(text)) {
        if (truthy((truthy((truthy(op.ne(c, " ")) && truthy(op.ne(c, "\n")))) && truthy(!truthy(call(font, "has_char", call(c, "unicode_at", 0))))))) {
          return false;
        }
      }
      return true;
    }
    _apply_theme(theme) {
      if (truthy(!truthy(call(theme, "has_meta", "hd_base")))) {
        call(theme, "set_meta", "hd_base", { "font": gd.member(theme, "default_font"), "size": gd.member(theme, "default_font_size") });
      }
      let base = call(theme, "get_meta", "hd_base");
      let map = this._hd_font(op.get(base, "font"));
      if (truthy(call(map, "is_empty"))) {
        return;
      }
      if (truthy(this.hd_enabled)) {
        theme.default_font = G.load(op.get(map, "font"));
        theme.default_font_size = G.roundi(op.mul(op.get(base, "size"), op.get(map, "scale")));
        if (truthy(call(map, "has", "outline"))) {
          for (let type of iter(OUTLINE_TYPES)) {
            call(theme, "set_constant", "outline_size", type, op.get(map, "outline"));
            call(theme, "set_color", "font_outline_color", type, call(map, "get", "outline_color", gd.member(gd.cls("Color"), "BLACK")));
          }
        }
        if (truthy(call(map, "has", "line_sep"))) {
          for (let type of iter(LINE_SEP_CONST)) {
            call(theme, "set_constant", op.get(LINE_SEP_CONST, type), type, op.get(map, "line_sep"));
          }
        }
      } else {
        theme.default_font = op.get(base, "font");
        theme.default_font_size = op.get(base, "size");
        if (truthy(call(map, "has", "outline"))) {
          for (let type of iter(OUTLINE_TYPES)) {
            call(theme, "clear_constant", "outline_size", type);
            call(theme, "clear_color", "font_outline_color", type);
          }
        }
        if (truthy(call(map, "has", "line_sep"))) {
          for (let type of iter(LINE_SEP_CONST)) {
            call(theme, "clear_constant", op.get(LINE_SEP_CONST, type), type);
          }
        }
      }
    }
    _apply_control(control) {
      if (truthy(!truthy(G.is_instance_valid(control)))) {
        return;
      }
      this._apply_texture_control(control);
      this._apply_styleboxes(control);
      if (truthy(gd.is(control, "Button"))) {
        this._apply_arrow(control);
      }
      if (truthy(op.ne(gd.member(control, "theme"), null))) {
        this._apply_theme(gd.member(control, "theme"));
      }
      let base = call(control, "get_meta", "hd_fonts", {  });
      for (let slot of iter(FONT_SLOTS)) {
        let size_slot = op.get(FONT_SLOTS, slot);
        if (truthy(!truthy(call(base, "has", slot)))) {
          if (truthy(!truthy(call(control, "has_theme_font_override", slot)))) {
            continue;
          }
          let font = call(control, "get_theme_font", slot);
          if (truthy(call(this._hd_font(font), "is_empty"))) {
            continue;
          }
          let size = (truthy(call(control, "has_theme_font_size_override", size_slot)) ? call(control, "get_theme_font_size", size_slot) : this._native_size(font));
          op.set(base, slot, { "font": font, "size": size });
        }
        let entry = op.get(base, slot);
        let map = this._hd_font(op.get(entry, "font"));
        let ttf = G.load(op.get(map, "font"));
        if (truthy((truthy(this.hd_enabled) && truthy(this._text_fits(control, ttf))))) {
          call(control, "add_theme_font_override", slot, ttf);
          call(control, "add_theme_font_size_override", size_slot, G.roundi(op.mul(op.get(entry, "size"), op.get(map, "scale"))));
          if (truthy(call(map, "has", "outline"))) {
            call(control, "add_theme_constant_override", "outline_size", op.get(map, "outline"));
            call(control, "add_theme_color_override", "font_outline_color", call(map, "get", "outline_color", gd.member(gd.cls("Color"), "BLACK")));
          }
          if (truthy(call(map, "has", "line_sep"))) {
            for (let type of iter(LINE_SEP_CONST)) {
              if (truthy(call(control, "is_class", type))) {
                call(control, "add_theme_constant_override", op.get(LINE_SEP_CONST, type), op.get(map, "line_sep"));
              }
            }
          }
        } else {
          call(control, "add_theme_font_override", slot, op.get(entry, "font"));
          call(control, "add_theme_font_size_override", size_slot, op.get(entry, "size"));
          if (truthy(call(map, "has", "outline"))) {
            call(control, "remove_theme_constant_override", "outline_size");
            call(control, "remove_theme_color_override", "font_outline_color");
          }
          if (truthy(call(map, "has", "line_sep"))) {
            for (let type of iter(LINE_SEP_CONST)) {
              if (truthy(call(control, "is_class", type))) {
                call(control, "remove_theme_constant_override", op.get(LINE_SEP_CONST, type));
              }
            }
          }
        }
      }
      if (truthy(!truthy(call(base, "is_empty")))) {
        call(control, "set_meta", "hd_fonts", base);
      }
    }
    _apply_animations(player) {
      for (let lib_name of iter(call(player, "get_animation_library_list"))) {
        let lib = call(player, "get_animation_library", lib_name);
        for (let anim_name of iter(call(lib, "get_animation_list"))) {
          let anim = call(lib, "get_animation", anim_name);
          for (let t of iter(call(anim, "get_track_count"))) {
            if (truthy(op.ne(call(anim, "track_get_type", t), gd.member(gd.cls("Animation"), "TYPE_VALUE")))) {
              continue;
            }
            for (let k of iter(call(anim, "track_get_key_count", t))) {
              let value = call(anim, "track_get_key_value", t, k);
              if (truthy(gd.is(value, "Texture2D"))) {
                let tex = this._target(value);
                if (truthy(op.ne(tex, value))) {
                  call(anim, "track_set_key_value", t, k, tex);
                }
              }
            }
          }
        }
      }
    }
  }
  Object.assign(hd_graphics, { HD_ROOT, CONFIG_PATH, TOGGLE_KEY, BANGERS, NUNITO_BOLD, NUNITO_BOLD_SPEECH, FONT_MAP, FONT_SLOTS, OUTLINE_TYPES, LINE_SEP_CONST, ARROW_ICONS, ARROW_ICON_WIDTH, HD_MARGIN, HD_DIALOG_COLORS, STYLE_SLOTS });
  return hd_graphics;
}
