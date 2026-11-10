// Escoria's menus (addons/escoria-core/ui_library/menus/): pause menu, main
// menu, save, load and options, drawn on the canvas with the game scene's
// menu theme (font) and Escoria's logo. Laid out like the original scenes
// (a centered column), not by a full Godot container engine.
import { BitmapFont } from "../../godot/bitmap_font.js";
import { cssColor } from "../../godot/values.js";

// escoria_ui translation keys, English (shown when the game has no translation)
const UI_TEXT = {
  NEW_GAME: "New game", CONTINUE_GAME: "Continue game", LOAD_GAME: "Load game", SAVE_GAME: "Save game",
  OPTIONS: "Options", QUIT: "Quit", OPTIONS_BACK: "Back", GENERAL_VOLUME: "General", MUSIC_VOLUME: "Music",
  SOUND_VOLUME: "Sound effects", SPEECH_VOLUME: "Speech", AMBIENT_VOLUME: "Ambient", FULLSCREEN: "Fullscreen", OPTIONS_LANGUAGE: "Language",
  CANCEL: "Cancel", OK: "OK", ENTER_SAVE_NAME: "Enter the save name:", APPLY: "Apply",
  CONFIRM_OVERWRITE: "Overwrite the savegame?", YES: "Yes", NO: "No",
};
const BG = "rgb(69, 69, 69)"; // the menus' ColorRect (0.27, 0.27, 0.27)
// options.gd: res://addons/escoria-core/ui_library/menus/options/flags/<locale>.png
export const FLAGS = "res://addons/escoria-core/ui_library/menus/options/flags/";

export const DEFAULT_SETTINGS = { master: 1, sfx: 1, music: 1, speech: 1, ambient: 1, fullscreen: false };

export class Menus {
  static async create(esc, gameScene, width, height) {
    const m = new Menus(esc, width, height);
    await m.load(gameScene);
    return m;
  }

  constructor(esc, width, height) {
    this.esc = esc;
    this.W = width;
    this.H = height;
    this.screen = null; // null, "pause", "main", "save", "load", "options", "name", "confirm"
    this.back = null; // screen to return to
    this.font = null;
    this.size = 32;
    this.logo = null;
    this.buttons = [];
    this.settings = { ...DEFAULT_SETTINGS, ...(esc.storageGet("settings") || {}) };
    this.draft = null; // options being edited
    this.backup = null; // the settings when the options opened
    this.flags = [];
    this.nameInput = "";
    this.pendingSlot = 0;
    this.scroll = 0;
    this.drag = null;
  }

  async load(gameScene) {
    const game = this.esc.game;
    // theme of the menus in the game scene (game.tscn: ui/pause_menu theme)
    const node = gameScene && gameScene.find((n) => /pause_menu|main_menu/.test(n.name) && n.props.theme);
    const theme = node && node.props.theme && node.props.theme.props;
    // the theme's font: a .fnt (its own size) or a FontFile / TTF (Godot 4's default size, 16)
    const df = theme && theme.default_font;
    const fontRes = df && (df.$res || df.path);
    if (fontRes && fontRes.endsWith(".fnt")) {
      this.font = await BitmapFont.load(game, fontRes);
      this.size = theme.default_font_size || this.font.size;
    } else if (fontRes) {
      try {
        this.font = await game.loadFont(fontRes);
        this.size = theme.default_font_size || 16;
      } catch {
        this.font = null;
      }
    }
    // custom_minimum_size of the buttons in Escoria's menu scenes (NEW_GAME: 150 high)
    this.minHeights = {};
    for (const f of ["res://addons/escoria-core/ui_library/menus/main_menu/main_menu.tscn", "res://addons/escoria-core/ui_library/menus/pause_menu/pause_menu.tscn"]) {
      for (const n of (game.files[f] && game.files[f].nodes) || []) {
        const m = n.props && n.props.custom_minimum_size;
        if (n.type === "Button" && n.props.text && m && m.args) this.minHeights[`${f.includes("main_menu") ? "main" : "pause"}:${n.props.text}`] = m.args[1];
      }
    }
    const logoRes = "res://addons/escoria-core/design/escoria-logo-small.png";
    const pause = game.files["res://addons/escoria-core/ui_library/menus/pause_menu/pause_menu.tscn"];
    const tex = pause && pause.nodes.find((n) => n.type === "TextureRect" && n.props.texture);
    const res = (tex && tex.props.texture.$res) || logoRes;
    this.logo = game.image(res) || (await game.loadImage(res));
  }

  // the game's translation of an escoria_ui key, else the English fallback
  tr(key) {
    const t = this.esc.game.tr(key);
    return t !== key ? t : UI_TEXT[key] || key;
  }

  get open() {
    return this.screen !== null;
  }

  /** The game is paused (game.gd pause_game(): the pause menu and what's opened from it; the main menu doesn't pause). */
  get paused() {
    return this.open && this.pausedGame;
  }

  // ---------------------------------------------------------------- screens

  showPause() {
    this.screen = "pause";
    this.pausedGame = true;
  }

  showMain() {
    this.screen = "main";
    this.pausedGame = false;
  }

  close() {
    this.screen = null;
    this.esc.hooks.menusClosed?.(); // game.gd hide_main_menu / unpause_game: show_ui()
  }

  /** Esc: opens the pause menu, or goes back / closes. */
  escape() {
    if (!this.open) return this.showPause();
    if (this.screen === "pause") return this.close();
    if (this.screen === "main") return;
    if (this.screen === "options") return this.cancelOptions();
    if (this.screen === "name" || this.screen === "confirm") this.screen = "save";
    else this.screen = this.back || "pause";
  }

  // ---------------------------------------------------------------- drawing helpers

  text(ctx, s, x, y, color = "#fff", align = "left") {
    if (this.font) {
      const w = this.font.measure(s, this.size);
      const dx = align === "center" ? -w / 2 : align === "right" ? -w : 0;
      this.font.draw(ctx, s, Math.round(x + dx), Math.round(y - this.font.lineHeightAt(this.size) / 2), color, this.size);
    } else {
      ctx.font = `${this.size}px system-ui, sans-serif`;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText(s, x, y);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
  }

  // a Godot-default-theme-like button
  button(ctx, mouse, b) {
    const hover = !b.disabled && mouse && mouse.x >= b.x && mouse.y >= b.y && mouse.x < b.x + b.w && mouse.y < b.y + b.h;
    ctx.fillStyle = hover ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.25)";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    const lines = b.label.split("\n");
    const lh = this.font ? this.font.lineHeightAt(this.size) : this.size;
    lines.forEach((l, i) => this.text(ctx, l, b.x + b.w / 2, b.y + b.h / 2 + (i - (lines.length - 1) / 2) * lh, b.disabled ? "#888" : hover ? "#ffe9a8" : "#fff", "center"));
    this.buttons.push(b);
  }

  /** A centered column: the logo, then buttons (pause_menu / main_menu scenes). */
  column(ctx, mouse, items) {
    const colW = 616, x = (this.W - colW) / 2;
    const lh = this.font ? this.font.lineHeightAt(this.size) : this.size;
    for (const it of items) it.h = Math.max(lh + 24, this.minHeights[`${this.screen}:${it.key}`] || 0);
    const logoH = this.logo ? Math.min(this.logo.height, 200) : 0;
    const total = logoH + (logoH ? 60 : 0) + items.reduce((a, it) => a + it.h + 10, 0) - 10;
    let y = Math.max(10, (this.H - total) / 2);
    if (this.logo) {
      const k = logoH / this.logo.height;
      ctx.drawImage(this.logo, (this.W - this.logo.width * k) / 2, y, this.logo.width * k, logoH);
      y += logoH + 60;
    }
    for (const it of items) {
      this.button(ctx, mouse, { x, y, w: colW, ...it });
      y += it.h + 10;
    }
  }

  draw(ctx, mouse) {
    if (!this.open) return;
    this.buttons = [];
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.W, this.H);
    const esc = this.esc;
    switch (this.screen) {
      case "pause":
        this.column(ctx, mouse, [
          { key: "CONTINUE_GAME", label: this.tr("CONTINUE_GAME"), on: () => this.close() },
          { key: "NEW_GAME", label: this.tr("NEW_GAME"), on: () => this.newGame() },
          { key: "SAVE_GAME", label: this.tr("SAVE_GAME"), disabled: !esc.saveEnabled, on: () => this.openList("save") },
          { key: "LOAD_GAME", label: this.tr("LOAD_GAME"), on: () => this.openList("load") },
          { key: "OPTIONS", label: this.tr("OPTIONS"), on: () => this.openOptions() },
          { key: "QUIT", label: this.tr("QUIT"), on: () => this.quit() },
        ]);
        break;
      case "main":
        this.column(ctx, mouse, [
          { key: "NEW_GAME", label: this.tr("NEW_GAME"), on: () => this.newGame() },
          { key: "LOAD_GAME", label: this.tr("LOAD_GAME"), on: () => this.openList("load") },
          { key: "OPTIONS", label: this.tr("OPTIONS"), on: () => this.openOptions() },
          { key: "QUIT", label: this.tr("QUIT"), on: () => this.quit() },
        ]);
        break;
      case "save":
      case "load":
        this.drawList(ctx, mouse);
        break;
      case "name":
        this.drawList(ctx, null);
        this.drawNamePopup(ctx, mouse);
        break;
      case "confirm":
        this.drawList(ctx, null);
        this.drawConfirm(ctx, mouse);
        break;
      case "options":
        this.drawOptions(ctx, mouse);
        break;
    }
  }

  // ---------------------------------------------------------------- save / load

  openList(kind) {
    this.back = this.screen === "main" ? "main" : "pause";
    this.screen = kind;
    this.scroll = 0;
  }

  // load_save menus: a list of slots (name and date) between 30% and 70% of the screen
  drawList(ctx, mouse) {
    const saves = this.esc.listSaves();
    const slots = Object.keys(saves).map(Number).sort((a, b) => a - b);
    const isSave = this.screen !== "load";
    const x = 0.3 * this.W - 55.5, w = 0.4 * this.W + 111, top = 0.3 * this.H, bottom = 0.7 * this.H;
    const rows = slots.map((s) => ({ slot: s, label: `${saves[s].name}\n${new Date(saves[s].date).toLocaleString()}` }));
    if (isSave) {
      const free = slots.length ? Math.max(...slots) + 1 : 1;
      rows.push({ slot: free, label: "+", fresh: true });
    }
    const rowH = 100;
    this.scroll = Math.max(0, Math.min(this.scroll, rows.length * (rowH + 4) - (bottom - top - 60)));
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, top, w, bottom - top - 60);
    ctx.clip();
    rows.forEach((r, i) => {
      const y = top + i * (rowH + 4) - this.scroll;
      this.button(ctx, mouse, { x, y, w, h: rowH, label: r.label, on: () => (isSave ? this.pickSaveSlot(r.slot, !r.fresh) : this.loadSlot(r.slot)) });
    });
    ctx.restore();
    if (!rows.length) this.text(ctx, "—", this.W / 2, top + 40, "#aaa", "center");
    this.button(ctx, mouse, { x, y: bottom - 50, w, h: 50, label: this.tr("OPTIONS_BACK"), on: () => this.cancelOptions() });
  }

  pickSaveSlot(slot, exists) {
    this.pendingSlot = slot;
    if (exists) this.screen = "confirm";
    else this.askName("");
  }

  askName(initial) {
    this.nameInput = initial;
    this.screen = "name";
  }

  popupBox() {
    const w = 640, h = 230;
    return { x: (this.W - w) / 2, y: (this.H - h) / 2, w, h };
  }

  drawNamePopup(ctx, mouse) {
    this.buttons = [];
    const b = this.popupBox();
    ctx.fillStyle = "rgb(40,40,44)";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    this.text(ctx, this.tr("ENTER_SAVE_NAME"), b.x + 30, b.y + 45);
    ctx.fillStyle = "#111";
    ctx.fillRect(b.x + 30, b.y + 80, b.w - 60, 56);
    const caret = Math.floor(performance.now() / 500) % 2 ? "_" : "";
    this.text(ctx, this.nameInput + caret, b.x + 40, b.y + 108);
    this.button(ctx, mouse, { x: b.x + b.w - 330, y: b.y + 160, w: 140, h: 50, label: this.tr("CANCEL"), on: () => (this.screen = "save") });
    this.button(ctx, mouse, { x: b.x + b.w - 170, y: b.y + 160, w: 140, h: 50, label: this.tr("OK"), on: () => this.confirmName() });
  }

  confirmName() {
    const name = this.nameInput.trim() || `Game ${this.pendingSlot}`;
    if (this.esc.saveGame(this.pendingSlot, name)) this.close();
    else this.screen = "save";
  }

  drawConfirm(ctx, mouse) {
    this.buttons = [];
    const b = this.popupBox();
    ctx.fillStyle = "rgb(40,40,44)";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    this.text(ctx, this.tr("CONFIRM_OVERWRITE"), b.x + b.w / 2, b.y + 70, "#fff", "center");
    const old = this.esc.listSaves()[this.pendingSlot];
    this.button(ctx, mouse, { x: b.x + b.w - 330, y: b.y + 160, w: 140, h: 50, label: this.tr("NO"), on: () => (this.screen = "save") });
    this.button(ctx, mouse, { x: b.x + b.w - 170, y: b.y + 160, w: 140, h: 50, label: this.tr("YES"), on: () => this.askName(old ? old.name : "") });
  }

  loadSlot(slot) {
    this.close();
    this.esc.loadGame(slot);
  }

  newGame() {
    this.close();
    this.esc.newGame();
  }

  quit() {
    this.close();
    this.esc.quit();
  }

  // ---------------------------------------------------------------- options

  // options.gd show(): backup_settings; the flags of the loaded locales (_ready)
  openOptions() {
    this.back = this.screen;
    this.draft = { ...this.settings, lang: this.esc.game.locale };
    this.backup = { ...this.draft };
    this.screen = "options";
    const game = this.esc.game;
    this.flags = game.locales().map((lang) => ({ lang, res: `${FLAGS}${lang}.png` })).filter((f) => game.exported.has(f.res));
    for (const f of this.flags) if (!game.image(f.res)) game.loadImage(f.res);
  }

  // _on_*_volume_changed(): the setting changes and applies at once
  liveSettings() {
    this.esc.settings = { ...this.draft };
    this.esc.applyVolumes();
  }

  // _on_language_input(): TranslationServer.set_locale()
  setLanguage(lang) {
    this.draft.lang = lang;
    this.esc.game.locale = lang;
    this.esc.ui.languageChanged?.();
  }

  // _on_back_pressed(): back to the settings it had when it opened
  cancelOptions() {
    this.draft = { ...this.backup };
    this.liveSettings();
    if (this.backup.lang && this.backup.lang !== this.esc.game.locale) this.setLanguage(this.backup.lang);
    this.screen = this.back || "pause";
  }

  sliders() {
    return [["GENERAL_VOLUME", "master"], ["SOUND_VOLUME", "sfx"], ["MUSIC_VOLUME", "music"], ["SPEECH_VOLUME", "speech"], ["AMBIENT_VOLUME", "ambient"]];
  }

  drawOptions(ctx, mouse) {
    const lh = this.font ? this.font.lineHeightAt(this.size) : this.size;
    const rowH = lh + 20;
    const flagH = 48;
    const rows = this.sliders().length + 1;
    let y = (this.H - (rows * rowH + 90 + (this.flags.length ? flagH + 20 : 0))) / 2 + rowH / 2;
    const lx = this.W / 2 - 40, sx = this.W / 2, sw = 420;
    if (this.flags.length) {
      // OPTIONS_LANGUAGE and a flag per language (the current one framed)
      this.text(ctx, this.tr("OPTIONS_LANGUAGE"), lx, y + flagH / 2 - rowH / 2, "#fff", "right");
      let fx = sx;
      for (const f of this.flags) {
        const img = this.esc.game.image(f.res);
        const w = img ? Math.round((img.width * flagH) / img.height) : flagH;
        const top = y - rowH / 2;
        if (img) ctx.drawImage(img, fx, top, w, flagH);
        if (f.lang === this.draft.lang || this.draft.lang?.split(/[_-]/)[0] === f.lang) {
          ctx.strokeStyle = "#ffe9a8";
          ctx.lineWidth = 3;
          ctx.strokeRect(fx - 3, top - 3, w + 6, flagH + 6);
          ctx.lineWidth = 1;
        }
        this.buttons.push({ x: fx, y: top, w, h: flagH, on: () => this.setLanguage(f.lang) });
        fx += w + 16;
      }
      y += flagH + 20;
    }
    for (const [key, field] of this.sliders()) {
      this.text(ctx, this.tr(key), lx, y, "#fff", "right");
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(sx, y - 4, sw, 8);
      const v = this.draft[field];
      ctx.fillStyle = "#ddd";
      ctx.fillRect(sx + v * sw - 8, y - 16, 16, 32);
      this.buttons.push({ x: sx - 10, y: y - 20, w: sw + 20, h: 40, slider: field, sx, sw });
      y += rowH;
    }
    this.text(ctx, this.tr("FULLSCREEN"), lx, y, "#fff", "right");
    this.button(ctx, mouse, { x: sx, y: y - 20, w: 40, h: 40, label: this.draft.fullscreen ? "x" : "", on: () => (this.draft.fullscreen = !this.draft.fullscreen) });
    y += rowH + 20;
    this.button(ctx, mouse, { x: this.W / 2 - 230, y, w: 210, h: 56, label: this.tr("OPTIONS_BACK"), on: () => (this.screen = this.back || "pause") });
    this.button(ctx, mouse, { x: this.W / 2 + 20, y, w: 210, h: 56, label: this.tr("APPLY"), on: () => this.applyOptions() });
  }

  applyOptions() {
    this.settings = { ...this.draft };
    this.esc.storageSet("settings", this.settings);
    this.esc.settings = this.settings;
    this.esc.ui.applySettings?.(this.settings);
    this.screen = this.back || "pause";
  }

  // ---------------------------------------------------------------- input

  hit(s) {
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      if (!b.disabled && s.x >= b.x && s.y >= b.y && s.x < b.x + b.w && s.y < b.y + b.h) return b;
    }
    return null;
  }

  pointerDown(s) {
    const b = this.hit(s);
    if (!b) return;
    if (b.slider) {
      this.drag = b;
      this.pointerMove(s);
    } else if (b.on) b.on();
  }

  pointerMove(s) {
    const d = this.drag;
    if (d && s) {
      this.draft[d.slider] = Math.min(1, Math.max(0, (s.x - d.sx) / d.sw));
      this.liveSettings();
    }
  }

  pointerUp() {
    this.drag = null;
  }

  wheel(dy) {
    if (this.screen === "save" || this.screen === "load") this.scroll += dy;
  }

  /** Keyboard while a menu is open; returns true if used. */
  key(e) {
    if (this.screen === "name") {
      if (e.key === "Enter") this.confirmName();
      else if (e.key === "Backspace") this.nameInput = this.nameInput.slice(0, -1);
      else if (e.key === "Escape") this.screen = "save";
      else if (e.key.length === 1 && this.nameInput.length < 40) this.nameInput += e.key;
      return true;
    }
    if (e.key === "Escape") {
      this.escape();
      return true;
    }
    return false;
  }
}

export { cssColor };
