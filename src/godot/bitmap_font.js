// BMFont text files (.fnt), the bitmap fonts Godot imports as FontFile
// (importer font_data_bmfont). Glyphs are drawn from the page images and
// tinted with the text color, as Godot modulates them.

export class BitmapFont {
  /** Loads `res` (a .fnt) and its page images from an exported game. */
  static async load(game, res) {
    const r = await fetch(game.url(res));
    if (!r.ok) throw new Error(`${res}: ${r.status}`);
    const font = new BitmapFont(await r.text());
    const dir = res.slice(0, res.lastIndexOf("/") + 1);
    font.pages = await Promise.all(font.pageFiles.map((f) => game.image(dir + f) || game.loadImage(dir + f)));
    return font;
  }

  constructor(text) {
    this.chars = new Map();
    this.kerning = new Map();
    this.pageFiles = [];
    this.tinted = new Map(); // "page|color" -> canvas
    for (const line of text.split(/\r?\n/)) {
      const m = /^(\w+)\s+(.*)$/.exec(line);
      if (!m) continue;
      const a = {};
      for (const kv of m[2].matchAll(/(\w+)=("([^"]*)"|\S+)/g)) a[kv[1]] = kv[3] !== undefined ? kv[3] : kv[2];
      switch (m[1]) {
        case "info": this.size = +a.size; break;
        case "common": this.lineHeight = +a.lineHeight; this.base = +a.base; break;
        case "page": this.pageFiles[+a.id] = a.file; break;
        case "char":
          this.chars.set(+a.id, { x: +a.x, y: +a.y, w: +a.width, h: +a.height, xo: +a.xoffset, yo: +a.yoffset, adv: +a.xadvance, page: +a.page || 0 });
          break;
        case "kerning": this.kerning.set(`${a.first},${a.second}`, +a.amount); break;
      }
    }
  }

  /** Does the font have this character? */
  has(ch) {
    return this.chars.has(ch.codePointAt(0));
  }

  glyph(code) {
    return this.chars.get(code) || this.chars.get(63); // "?" for missing characters
  }

  /** Width of `text` at `size` px (the font's own size when omitted). */
  measure(text, size = this.size) {
    const s = size / this.size;
    let w = 0, prev = null;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      const g = this.glyph(c);
      if (prev !== null) w += this.kerning.get(`${prev},${c}`) || 0;
      if (g) w += g.adv;
      prev = c;
    }
    return w * s;
  }

  lineHeightAt(size = this.size) {
    return (this.lineHeight * size) / this.size;
  }

  /** Draws `text` with its top-left corner at (x, y). */
  draw(ctx, text, x, y, color = "#fff", size = this.size) {
    const s = size / this.size;
    let pen = 0, prev = null;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      const g = this.glyph(c);
      if (prev !== null) pen += this.kerning.get(`${prev},${c}`) || 0;
      prev = c;
      if (!g) continue;
      if (g.w && g.h) {
        const page = this.page(g.page, color);
        if (page) ctx.drawImage(page, g.x, g.y, g.w, g.h, x + (pen + g.xo) * s, y + g.yo * s, g.w * s, g.h * s);
      }
      pen += g.adv;
    }
  }

  // the page image tinted with `color` (glyphs are white)
  page(i, color) {
    const key = `${i}|${color}`;
    if (!this.tinted.has(key)) {
      const img = this.pages[i];
      if (!img) return null;
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const cx = c.getContext("2d");
      cx.drawImage(img, 0, 0);
      cx.globalCompositeOperation = "multiply";
      cx.fillStyle = color;
      cx.fillRect(0, 0, c.width, c.height);
      cx.globalCompositeOperation = "destination-in";
      cx.drawImage(img, 0, 0);
      this.tinted.set(key, c);
    }
    return this.tinted.get(key);
  }
}

/**
 * Word wrap as Godot's AUTOWRAP_WORD_SMART: break between words; a word
 * longer than the line goes on its own line.
 */
export function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const w of para.split(" ")) {
      const next = cur ? cur + " " + w : w;
      if (cur && measure(next) > maxWidth) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    lines.push(cur);
  }
  return lines;
}
