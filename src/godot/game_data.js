// An exported game (tools/export.js): game.json plus the assets under res/.
// Resolves sub-resources and .tres resources, and loads images.

import { setGame } from "./controls.js";

export class GameData {
  /** @param base URL of the export folder (the one holding game.json) */
  static async load(base) {
    base = base.replace(/\/?$/, "/");
    const r = await fetch(base + "game.json");
    if (!r.ok) throw new Error(`${base}game.json: ${r.status}`);
    return new GameData(base, await r.json());
  }

  constructor(base, json) {
    this.base = base;
    this.json = json;
    this.settings = json.settings;
    this.files = json.files;
    this.scripts = json.scripts;
    this.images = new Map(); // res path -> HTMLImageElement (once loaded)
    this.resources = new Map(); // .tres path -> resolved resource
    this.exported = new Set(json.assets || []); // exported asset paths
    this.fonts = new Map(); // res -> BitmapFont | TTFont (loaded) | Promise
    // translations (from the project's CSVs): {locale: {key: text}}
    this.translations = json.translations || {};
    const lang = String(this.setting("escoria/main/text_lang", "en"));
    this.locale = lang;
    setGame(this);
  }

  /** TranslationServer.translate(): the text for `key` in the current locale ("es_AR" falls back to "es"). */
  tr(key) {
    if (typeof key !== "string" || !key) return key;
    const t = this.translations;
    const l = this.locale, short = l.split(/[_-]/)[0];
    return (t[l] && t[l][key]) ?? (t[short] && t[short][key]) ?? key;
  }

  /** Locales with translations ("en", "es"...). */
  locales() {
    return Object.keys(this.translations);
  }

  /** A loaded font (BitmapFont / TTFont) for res, or null (it starts loading). */
  font(res) {
    if (!res) return null;
    const f = this.fonts.get(res);
    if (f && !(f instanceof Promise)) return f;
    if (!f) {
      const p = (async () => {
        const mod = res.endsWith(".fnt") ? await import("./bitmap_font.js") : await import("./ttf_font.js");
        return res.endsWith(".fnt") ? mod.BitmapFont.load(this, res) : mod.TTFont.load(this, res);
      })();
      this.fonts.set(res, p);
      p.then((font) => this.fonts.set(res, font)).catch((e) => {
        console.warn("couldn't load font", res, e);
        this.fonts.delete(res);
      });
    }
    return null;
  }

  /** Loads a font and waits for it. */
  async loadFont(res) {
    this.font(res);
    const f = this.fonts.get(res);
    return f instanceof Promise ? f : f;
  }

  /**
   * The font to draw text with: {font, size}. null while the font is loading.
   */
  resolveFont(res, size) {
    const font = this.font(res);
    return font ? { font, size: size || font.size } : null;
  }

  /** Was this res:// path exported (after the remap)? */
  has(res) {
    return this.exported.has((this.json.remap && this.json.remap[res]) || res);
  }

  /** The picture to draw for a texture: {img}, or null while it loads. */
  /**
   * A texture: an image path, {"$res": image} or an AtlasTexture (a region of
   * its `atlas`). Returns {img, sx, sy, sw, sh} or null.
   */
  texture(t) {
    if (!t) return null;
    if (typeof t === "string" || t.$res !== undefined) {
      const img = this.image(typeof t === "string" ? t : t.$res);
      return img ? { img, sx: 0, sy: 0, sw: img.width, sh: img.height } : null;
    }
    if (t.type === "AnimatedTexture") {
      // its frames by time (looping), or current_frame while paused
      const p = t.props, n = Math.max(1, p.frames ?? 1);
      let i = p.current_frame ?? 0;
      if (!p.pause) {
        const durs = [];
        for (let k = 0; k < n; k++) durs.push(p[`frame_${k}/duration`] ?? 1);
        const total = durs.reduce((a, b) => a + b, 0) || 1;
        let x = ((performance.now() / 1000) * (p.speed_scale ?? 1)) % total;
        for (i = 0; i < n - 1 && x >= durs[i]; i++) x -= durs[i];
      }
      return this.texture(p[`frame_${i}/texture`]);
    }
    if (t.type === "AtlasTexture") {
      const base = this.texture(t.props.atlas);
      if (!base) return null;
      const r = t.props.region && t.props.region.args;
      if (!r || !(r[2] > 0 && r[3] > 0)) return base;
      return { img: base.img, sx: base.sx + r[0], sy: base.sy + r[1], sw: r[2], sh: r[3] };
    }
    return null;
  }

  setting(key, def) {
    return key in this.settings ? this.settings[key] : def;
  }

  /** URL of an exported asset (following the exporter's remap: .wav -> .ogg). */
  url(res) {
    const r = (this.json.remap && this.json.remap[res]) || res;
    return this.base + "res/" + r.slice(6);
  }

  /**
   * Replaces {"$sub": id} with the scene's sub_resource ({type, props, id}) and
   * {"$res": "x.tres"} with the loaded resource, recursively. Images and
   * scenes stay as {"$res": path}. `subs` caches the resolved sub_resources of
   * one file.
   */
  resolve(value, file, subs = new Map()) {
    const doc = this.files[file];
    const walk = (v) => {
      if (Array.isArray(v)) return v.map(walk);
      if (!v || typeof v !== "object") return v;
      if (v.$sub !== undefined) {
        if (!subs.has(v.$sub)) {
          const s = doc.sub[v.$sub];
          if (!s) throw new Error(`${file}: no sub_resource ${v.$sub}`);
          const out = { type: s.type, id: v.$sub, props: {} };
          subs.set(v.$sub, out); // before resolving its props: resources can point back
          for (const [k, x] of Object.entries(s.props)) out.props[k] = walk(x);
        }
        return subs.get(v.$sub);
      }
      if (v.$res !== undefined) {
        return /\.(tres|gdshader)$/.test(v.$res) && this.files[v.$res] ? this.resource(v.$res) : v;
      }
      if (v.type && v.args) return v; // Vector2(...), Color(...): leave as is
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    };
    return walk(value);
  }

  /** A .tres file as {type, props, path}, sub-resources resolved. */
  resource(path) {
    if (!this.resources.has(path)) {
      const doc = this.files[path];
      if (!doc) throw new Error(`not exported: ${path}`);
      const out = { type: doc.type, path, props: {} };
      this.resources.set(path, out);
      Object.assign(out.props, this.resolve(doc.props, path));
    }
    return this.resources.get(path);
  }

  image(res) {
    return this.images.get(res) || null;
  }

  /** Loads every image referenced (as {"$res": "*.png"...}) inside `value`. */
  async loadImagesIn(value) {
    const paths = new Set();
    const seen = new Set();
    const walk = (v) => {
      if (!v || typeof v !== "object" || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) return v.forEach(walk);
      if (typeof v.$res === "string" && /\.(png|jpe?g|webp|svg)$/i.test(v.$res)) {
        paths.add(v.$res);
      }
      for (const x of Object.values(v)) walk(x);
    };
    walk(value);
    await Promise.all([...paths].filter((p) => !this.images.has(p)).map((p) => this.loadImage(p)));
  }

  loadImage(res) {
    return new Promise((ok) => {
      const img = new Image();
      img.onload = () => {
        this.images.set(res, img);
        ok(img);
      };
      img.onerror = () => {
        console.warn("couldn't load", res);
        ok(null);
      };
      img.src = this.url(res);
    });
  }
}
