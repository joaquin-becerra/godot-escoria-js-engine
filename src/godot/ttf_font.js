// TrueType / OpenType fonts (FontFile .ttf / .otf, and FontVariation .tres on
// top of one), drawn with the browser's text rendering. Same interface as
// BitmapFont: measure(), lineHeightAt(), draw(), has().
//
// FontVariation: variation_opentype "wght" (2003265652) -> CSS font-weight,
// spacing_glyph -> extra space after every glyph (drawn glyph by glyph).
const WGHT = 2003265652; // "wght"
let families = 0;

export class TTFont {
  /** `res`: a .ttf / .otf, or a FontVariation .tres whose base_font is one. */
  static async load(game, res) {
    let file = res, weight = 400, spacing = 0, size = 16;
    if (res.endsWith(".tres")) {
      // FontVariation (base_font) or a FontFile resource (font_data, size)
      const v = game.resource(res).props;
      file = (v.base_font || v.font_data || {}).$res;
      if (v.size) size = v.size;
      const vo = v.variation_opentype || {};
      if (vo[WGHT] !== undefined) weight = vo[WGHT];
      spacing = v.spacing_glyph || 0;
    }
    const family = `escoria-ttf-${++families}`;
    let css = `"${family}"`;
    try {
      const face = new FontFace(family, `url("${game.url(file)}")`, { weight: "1 1000" });
      await face.load();
      document.fonts.add(face);
    } catch (e) {
      // the browser rejected the file (Firefox's sanitizer is stricter than
      // Godot): the text still shows, in the browser's serif
      if (typeof FontFace === "undefined") throw e;
      console.warn(`font ${file} rejected by the browser, using serif`, e);
      css = "serif";
    }
    const font = new TTFont(css, weight, spacing);
    font.size = size;
    return font;
  }

  constructor(family, weight, spacing) {
    this.family = family;
    this.weight = weight;
    this.spacing = spacing;
    this.size = 16;
    this.metrics = new Map(); // size -> {ascent, descent}
    this.ctx = document.createElement("canvas").getContext("2d");
  }

  css(size) {
    return `${this.weight} ${size}px ${this.family}`;
  }

  m(size) {
    if (!this.metrics.has(size)) {
      this.ctx.font = this.css(size);
      const t = this.ctx.measureText("Hgjy");
      this.metrics.set(size, { ascent: t.fontBoundingBoxAscent ?? size * 0.8, descent: t.fontBoundingBoxDescent ?? size * 0.25 });
    }
    return this.metrics.get(size);
  }

  /** Does the font draw this character? (control characters: no) */
  has(ch) {
    const c = ch.codePointAt(0);
    return c >= 32 && !(c >= 0x7f && c < 0xa0);
  }

  measure(text, size = this.size) {
    this.ctx.font = this.css(size);
    if (!this.spacing) return this.ctx.measureText(text).width;
    let w = 0;
    for (const ch of text) w += this.ctx.measureText(ch).width + this.spacing;
    return w;
  }

  lineHeightAt(size = this.size) {
    const { ascent, descent } = this.m(size);
    return ascent + descent;
  }

  /** Draws `text` with its top-left corner at (x, y). opts: {outline, outlineColor} */
  draw(ctx, text, x, y, color = "#fff", size = this.size, opts = {}) {
    const { ascent } = this.m(size);
    ctx.save();
    ctx.font = this.css(size);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    const base = y + ascent;
    const pieces = [];
    if (this.spacing) {
      let pen = x;
      for (const ch of text) {
        pieces.push([ch, pen]);
        pen += ctx.measureText(ch).width + this.spacing;
      }
    } else pieces.push([text, x]);
    if (opts.outline) {
      // Godot's outline_size: FreeType strokes with a radius of outline_size * 16
      // in 1/64 px (text_server_adv.cpp, FT_Stroker_Set), i.e. outline_size / 4 px
      // each side: a canvas stroke (centered on the edge) of outline_size / 2
      ctx.lineJoin = "round";
      ctx.lineWidth = opts.outline / 2;
      ctx.strokeStyle = opts.outlineColor || "#000";
      for (const [s, px] of pieces) ctx.strokeText(s, px, base);
    }
    ctx.fillStyle = color;
    for (const [s, px] of pieces) ctx.fillText(s, px, base);
    ctx.restore();
  }
}
