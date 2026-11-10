// Resources for translated GDScript: load() / preload(), PackedScene,
// Texture2D, AudioStream, Font, StyleBox*, and ConfigFile / FileAccess over
// the browser's storage.
//
// An engine resource is either a reference {$res: "res://..."} or an inline
// object {type, props} (sub-resources, StyleBoxes). GdResource wraps both:
// its properties read and write the engine object's props, so what a script
// changes is what the renderer draws.
import { GdObject } from "./object.js";
import { fromEngine, toEngine, setResourceCodec } from "./values.js";

/**
 * A Proxy that falls back to an engine props object: reads of names the
 * object doesn't have come from props(target) (converted), and so do writes
 * (a GDScript script can't add properties to an object: a name it assigns
 * that isn't one of its vars is the engine object's property). Names starting
 * with "__" are the bridge's own. `in` sees both.
 */
export function propsProxy(obj, props) {
  return new Proxy(obj, {
    get(t, k, r) {
      if (typeof k === "symbol" || k in t) return Reflect.get(t, k, r);
      const p = props(t);
      return p && k in p ? fromEngine(p[k]) : undefined;
    },
    set(t, k, v, r) {
      if (typeof k === "symbol" || k in t || k.startsWith("__")) return Reflect.set(t, k, v, r);
      const p = props(t);
      if (p) {
        p[k] = toEngine(v);
        return true;
      }
      return Reflect.set(t, k, v, r);
    },
    has(t, k) {
      if (k in t) return true;
      const p = props(t);
      return !!(p && typeof k === "string" && k in p);
    },
  });
}

const raws = new WeakMap(); // engine resource object -> GdResource

export class GdResource extends GdObject {
  static gdClass = "Resource";

  /** The GdResource for an engine resource ({$res} or {type, props}), always the same one. */
  static wrap(raw, bridge) {
    if (!raw || typeof raw !== "object") return raw;
    if (raws.has(raw)) return raws.get(raw);
    const path = raw.$res || null;
    const type = raw.type || typeOf(path, bridge);
    const Cls = RESOURCE_CLASSES[type] || GdResource;
    return new Cls(raw, bridge);
  }

  constructor(raw = null, bridge = GdResource.bridge) {
    super();
    if (!raw) raw = { type: new.target.gdClass, props: {} };
    this.__raw = raw;
    this.__bridge = bridge;
    const p = propsProxy(this, (t) => t.__props);
    raws.set(raw, p);
    return p;
  }

  // the props: inline ones, or those of the .tres a reference points to
  get __props() {
    const r = this.__raw;
    if (r.props) return r.props;
    if (r.$res && /\.tres$/.test(r.$res) && this.__bridge) {
      try {
        return this.__bridge.game.resource(r.$res).props;
      } catch {
        return null;
      }
    }
    return null;
  }
  get resource_path() { return this.__raw.$res || ""; }
  get resource_name() { return (this.__raw.$res || "").split("/").pop(); }
  duplicate() {
    const r = this.__raw.props ? { type: this.__raw.type, props: structuredClone(this.__raw.props) } : { ...this.__raw };
    return GdResource.wrap(r, this.__bridge);
  }
  get_class() { return this.__raw.type || this.constructor.gdClass; }
  is_class(name) { return name === "Resource" || name === this.get_class() || super.is_class(name); }
}

// the type of a referenced file, from its extension or the .tres
function typeOf(path, bridge) {
  if (!path) return "Resource";
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "tscn") return "PackedScene";
  if (["png", "jpg", "jpeg", "webp", "svg"].includes(ext)) return "Texture2D";
  if (["ogg", "wav", "mp3"].includes(ext)) return "AudioStream";
  if (["ttf", "otf", "woff", "woff2", "fnt"].includes(ext)) return "Font";
  if (ext === "tres" && bridge) {
    try {
      return bridge.game.resource(path).type || "Resource";
    } catch {
      return "Resource";
    }
  }
  return "Resource";
}

/** PackedScene: instantiate() builds the scene's nodes (and their scripts). */
class GdPackedScene extends GdResource {
  static gdClass = "PackedScene";
  instantiate() {
    return this.__bridge.instantiate(this.__raw.$res);
  }
  can_instantiate() { return true; }
}

/**
 * Texture2D: its size (the picture must be loaded; HD pictures count at their
 * original size). An ImageTexture made by a script keeps its picture in
 * __raw.__source (a canvas).
 */
class GdTexture extends GdResource {
  static gdClass = "Texture2D";
  get __tex() {
    if (this.__raw.__source) return { img: this.__raw.__source };
    return this.__bridge && this.__raw.$res ? this.__bridge.game.texture(this.__raw.$res) : null;
  }
  static create_from_image(image) {
    return GdResource.wrap({ type: "ImageTexture", props: {}, __source: image ? image.__canvas : null }, GdResource.bridge);
  }
  set_image(image) { this.__raw.__source = image ? image.__canvas : null; }
  update(image) { this.set_image(image); }
  get_image() { const t = this.__tex; return t ? GdImage.fromPicture(t.img) : null; }
  // the picture's size, or (not loaded yet) the size the exporter read from the file
  __size() {
    const t = this.__tex;
    if (t) return [t.img.width, t.img.height];
    const s = this.__bridge && this.__raw.$res && (this.__bridge.game.json.imageSizes || {})[this.__raw.$res];
    return s || [0, 0];
  }
  get_width() { return this.__size()[0]; }
  get_height() { return this.__size()[1]; }
  get_size() { return fromEngine({ type: "Vector2", args: [this.get_width(), this.get_height()] }); }
}

/** Image: a picture in memory (a canvas), e.g. the screen captured by get_viewport().get_texture().get_image(). */
export class GdImage extends GdResource {
  static gdClass = "Image";
  static fromPicture(pic) {
    const img = new GdImage();
    img.__canvas = pic || null;
    return img;
  }
  get_width() { return this.__canvas ? this.__canvas.width : 0; }
  get_height() { return this.__canvas ? this.__canvas.height : 0; }
  get_size() { return fromEngine({ type: "Vector2", args: [this.get_width(), this.get_height()] }); }
  is_empty() { return !this.__canvas || !this.__canvas.width; }
  get_region(rect) {
    const src = this.__canvas;
    if (!src || typeof document === "undefined") return GdImage.fromPicture(null);
    const { x, y } = rect.position, { x: w, y: h } = rect.size;
    const c = document.createElement("canvas");
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    c.getContext("2d").drawImage(src, x, y, w, h, 0, 0, w, h);
    return GdImage.fromPicture(c);
  }
  duplicate() { return this.get_region({ position: { x: 0, y: 0 }, size: { x: this.get_width(), y: this.get_height() } }); }
}

/** Shader: its code (Godot's shading language; src/godot/shaders.js runs it). */
class GdShader extends GdResource {
  static gdClass = "Shader";
  get code() { return this.__props.code ?? ""; }
  set code(s) { this.__props.code = String(s); }
}

/** ShaderMaterial: the shader and its parameters ("shader_parameter/<name>" props, as Godot keeps them). */
class GdShaderMaterial extends GdResource {
  static gdClass = "ShaderMaterial";
  set_shader_parameter(name, v) { this.__props[`shader_parameter/${name}`] = toEngine(v); }
  get_shader_parameter(name) { return fromEngine(this.__props[`shader_parameter/${name}`]) ?? null; }
}

/** SpriteFrames: the animations of an AnimatedSprite2D ({name, speed, loop, frames: [{texture, duration}]}). */
class GdSpriteFrames extends GdResource {
  static gdClass = "SpriteFrames";
  get __anims() { return (this.__props.animations ||= []); }
  __anim(name) { return this.__anims.find((a) => a.name === String(name)) || null; }
  get_animation_names() { return this.__anims.map((a) => a.name); }
  has_animation(name) { return !!this.__anim(name); }
  get_frame_count(name) { return this.__anim(name)?.frames.length ?? 0; }
  get_frame_texture(name, i) { const f = this.__anim(name)?.frames[i]; return f ? fromEngine(f.texture) : null; }
  get_frame_duration(name, i) { return this.__anim(name)?.frames[i]?.duration ?? 1; }
  set_frame(name, i, tex, duration = 1) {
    const a = this.__anim(name);
    if (!a) return;
    a.frames[i] = { texture: toEngine(tex), duration };
    if (tex && tex.resource_path && this.__bridge) this.__bridge.game.loadImagesIn?.({ $res: tex.resource_path });
  }
  add_frame(name, tex, duration = 1, at = -1) {
    const a = this.__anim(name);
    if (!a) return;
    const f = { texture: toEngine(tex), duration };
    if (at < 0) a.frames.push(f);
    else a.frames.splice(at, 0, f);
  }
  get_animation_speed(name) { return this.__anim(name)?.speed ?? 5; }
  set_animation_speed(name, s) { const a = this.__anim(name); if (a) a.speed = s; }
  get_animation_loop(name) { return !!(this.__anim(name)?.loop ?? true); }
  set_animation_loop(name, l) { const a = this.__anim(name); if (a) a.loop = !!l; }
}

/** AnimationLibrary: animations by name (props._data). */
class GdAnimationLibrary extends GdResource {
  static gdClass = "AnimationLibrary";
  get __data() { return (this.__props._data ||= {}); }
  get_animation_list() { return Object.keys(this.__data); }
  has_animation(name) { return String(name) in this.__data; }
  get_animation(name) { return fromEngine(this.__data[String(name)]) ?? null; }
}

/** Animation: its tracks ("tracks/<n>/<field>" props), as the engine plays them. */
const TRACK_TYPES = ["value", "position_3d", "rotation_3d", "scale_3d", "blend_shape", "method", "bezier", "audio", "animation"];
class GdAnimation extends GdResource {
  static gdClass = "Animation";
  static TYPE_VALUE = 0; static TYPE_POSITION_3D = 1; static TYPE_ROTATION_3D = 2; static TYPE_SCALE_3D = 3; static TYPE_BLEND_SHAPE = 4;
  static TYPE_METHOD = 5; static TYPE_BEZIER = 6; static TYPE_AUDIO = 7; static TYPE_ANIMATION = 8;
  static LOOP_NONE = 0; static LOOP_LINEAR = 1; static LOOP_PINGPONG = 2;
  __track(t, field) { return this.__props[`tracks/${t}/${field}`]; }
  get_track_count() { let n = 0; while (this.__track(n, "type") !== undefined) n++; return n; }
  track_get_type(t) { return Math.max(0, TRACK_TYPES.indexOf(this.__track(t, "type"))); }
  track_get_path(t) { const p = this.__track(t, "path"); return p && p.args ? p.args[0] : p || ""; }
  track_is_enabled(t) { return this.__track(t, "enabled") !== false; }
  track_get_key_count(t) { const k = this.__track(t, "keys"); return k && k.values ? k.values.length : 0; }
  track_get_key_value(t, k) { const keys = this.__track(t, "keys"); return keys && keys.values ? fromEngine(keys.values[k]) : null; }
  track_set_key_value(t, k, v) {
    const keys = this.__track(t, "keys");
    if (!keys || !keys.values) return;
    keys.values[k] = toEngine(v);
    if (v && v.resource_path && /\.(png|jpe?g|webp)$/i.test(v.resource_path) && this.__bridge) this.__bridge.game.loadImagesIn?.({ $res: v.resource_path });
  }
  track_get_key_time(t, k) { const keys = this.__track(t, "keys"); const times = keys && keys.times; return times ? (times.args || times)[k] : 0; }
  get length() { return this.__props.length ?? 1; }
}

/**
 * Theme: default font and size, and the values per control type
 * ("<Type>/<kind>/<name>" props: Label/constants/outline_size...).
 */
class GdTheme extends GdResource {
  static gdClass = "Theme";
  __key(kind, name, type) { return `${type}/${kind}/${name}`; }
  set_constant(name, type, v) { this.__props[this.__key("constants", name, type)] = v; }
  get_constant(name, type) { return this.__props[this.__key("constants", name, type)] ?? 0; }
  has_constant(name, type) { return this.__key("constants", name, type) in this.__props; }
  clear_constant(name, type) { delete this.__props[this.__key("constants", name, type)]; }
  set_color(name, type, c) { this.__props[this.__key("colors", name, type)] = toEngine(c); }
  get_color(name, type) { return fromEngine(this.__props[this.__key("colors", name, type)]) ?? null; }
  has_color(name, type) { return this.__key("colors", name, type) in this.__props; }
  clear_color(name, type) { delete this.__props[this.__key("colors", name, type)]; }
  set_font(name, type, f) { this.__props[this.__key("fonts", name, type)] = toEngine(f); }
  get_font(name, type) { return fromEngine(this.__props[this.__key("fonts", name, type)]) ?? null; }
  clear_font(name, type) { delete this.__props[this.__key("fonts", name, type)]; }
  set_font_size(name, type, s) { this.__props[this.__key("font_sizes", name, type)] = s; }
  set_stylebox(name, type, s) { this.__props[this.__key("styles", name, type)] = toEngine(s); }
  get_stylebox(name, type) { return fromEngine(this.__props[this.__key("styles", name, type)]) ?? null; }
}

class GdAudioStream extends GdResource {
  static gdClass = "AudioStream";
  get_length() { return 0; }
}

class GdFont extends GdResource {
  static gdClass = "Font";
  __resolve(size) { return this.__bridge.game.resolveFont(this.__raw.$res, size); }
  get_string_size(text, _align = 0, _width = -1, size = 16) {
    const f = this.__resolve(size);
    const s = String(text);
    return fromEngine({ type: "Vector2", args: [f ? f.font.measure(s, f.size) : s.length * size * 0.55, this.get_height(size)] });
  }
  get_height(size = 16) {
    const f = this.__resolve(size);
    return f ? f.font.lineHeightAt(f.size) : size * 1.3;
  }
  has_char(code) {
    const f = this.__resolve(16);
    return f ? f.font.has(String.fromCodePoint(code)) : true;
  }
}

class GdStyleBox extends GdResource { static gdClass = "StyleBox"; }
class GdStyleBoxEmpty extends GdStyleBox { static gdClass = "StyleBoxEmpty"; }
class GdStyleBoxFlat extends GdStyleBox { static gdClass = "StyleBoxFlat"; }
class GdStyleBoxTexture extends GdStyleBox { static gdClass = "StyleBoxTexture"; }

export const RESOURCE_CLASSES = {
  Resource: GdResource, PackedScene: GdPackedScene, Texture2D: GdTexture, CompressedTexture2D: GdTexture, ImageTexture: GdTexture,
  AtlasTexture: GdTexture, AudioStream: GdAudioStream, AudioStreamOggVorbis: GdAudioStream, AudioStreamWAV: GdAudioStream,
  AudioStreamMP3: GdAudioStream, Font: GdFont, FontFile: GdFont, FontVariation: GdFont, SystemFont: GdFont,
  SpriteFrames: GdSpriteFrames, AnimationLibrary: GdAnimationLibrary, Animation: GdAnimation, Theme: GdTheme,
  Image: GdImage, Shader: GdShader, ShaderMaterial: GdShaderMaterial, CanvasItemMaterial: GdResource,
  StyleBox: GdStyleBox, StyleBoxEmpty: GdStyleBoxEmpty, StyleBoxFlat: GdStyleBoxFlat, StyleBoxTexture: GdStyleBoxTexture,
};

// engine values <-> bridge values: resources wrap / unwrap
setResourceCodec({
  is: (v) => v && typeof v === "object" && (typeof v.$res === "string" || (typeof v.type === "string" && v.props && typeof v.props === "object")),
  wrap: (v) => GdResource.wrap(v, GdResource.bridge),
  unwrap: (v) => (v instanceof GdResource ? v.__raw : v),
});

// ---------------------------------------------------------------- files

/** user:// files live in the browser's storage (under the game's prefix); res:// ones are the exported game. */
export function makeFiles(bridge) {
  const esc = bridge.esc;
  const userKey = (p) => "file:" + p.replace(/^user:\/\//, "");
  const exists = (p) => {
    p = String(p);
    if (p.startsWith("user://")) return esc.storageGet(userKey(p)) !== null;
    if (p.startsWith("res://")) return bridge.game.has(p) || !!bridge.game.files[p] || !!(bridge.game.json.scripts || {})[p];
    return false;
  };

  /** ConfigFile: sections of keys, saved as JSON. */
  class ConfigFile extends GdObject {
    constructor() {
      super();
      this.__data = {};
    }
    load(path) {
      const d = String(path).startsWith("user://") ? esc.storageGet(userKey(path)) : null;
      if (!d) return 7; // ERR_FILE_NOT_FOUND
      this.__data = d;
      return 0;
    }
    save(path) {
      if (!String(path).startsWith("user://")) return 1;
      esc.storageSet(userKey(path), this.__data);
      return 0;
    }
    get_value(section, key, def = null) {
      const s = this.__data[section];
      return s && key in s ? fromEngine(s[key]) : def;
    }
    set_value(section, key, value) {
      if (value === null) delete (this.__data[section] || {})[key];
      else (this.__data[section] ||= {})[key] = toEngine(value);
    }
    has_section(section) { return section in this.__data; }
    has_section_key(section, key) { return !!this.__data[section] && key in this.__data[section]; }
    get_sections() { return Object.keys(this.__data); }
    get_section_keys(section) { return Object.keys(this.__data[section] || {}); }
    erase_section(section) { delete this.__data[section]; }
    erase_section_key(section, key) { delete (this.__data[section] || {})[key]; }
    clear() { this.__data = {}; }
  }

  const FileAccess = {
    file_exists: exists,
    READ: 1, WRITE: 2, READ_WRITE: 3, WRITE_READ: 7,
  };
  const DirAccess = { dir_exists_absolute: () => true, make_dir_recursive_absolute: () => 0, make_dir_absolute: () => 0 };
  const ResourceLoader = { exists: (p) => exists(p), load: (p) => bridge.load(p) };
  return { ConfigFile, FileAccess, DirAccess, ResourceLoader, exists };
}
