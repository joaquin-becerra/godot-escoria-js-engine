// The game scene (setting escoria/ui/game_scene) drawn on a canvas, with the
// 9-verbs UI logic (escoria-ui-keyboard-9verbs/game.gd, verbs_menu.gd), the
// sentence line (ESCTooltip), floating speech (escoria-dialog-simple
// floating.gd) and the dialog chooser (dialog-simple chooser/simple).
//
// The game's translated scripts take them over through esc.hooks.ui (the bridge
// sets these):
//   sentence(ui) -> string  the sentence line's text
//   dialog {active(), say(obj, text, cmd) -> {secs}, layout(speech) -> {w} | null, finished(speech)}
//                           the game's floating dialog script (translated)
//   chooser {active(), show(dialog, choose)}   the game's chooser script: it draws
//                           its own buttons (scene Controls); choose(option | null)
//
// Controls are laid out from their anchors and offsets (what the converted
// games use); containers don't arrange their children yet.
import { instantiate } from "../../godot/scene.js";
import { wrapText } from "../../godot/bitmap_font.js";
import { globalTransform, apply, multiply, smoothFor, collect, draw } from "../../godot/render.js";
import { points, vec2, cssColor, color as readColor } from "../../godot/values.js";
import { isItem } from "../room.js";
import { STATE } from "../actions.js";

const CONTROL_TYPES = new Set(["Control", "TextureRect", "Button", "RichTextLabel", "Label", "ScrollContainer", "GridContainer", "MarginContainer", "VBoxContainer", "HBoxContainer", "Panel", "ColorRect"]);

export class GameUI {
  /** @param esc Escoria runtime; width/height: viewport size */
  static async create(esc, width, height) {
    const ui = new GameUI(esc, width, height);
    await ui.load();
    return ui;
  }

  constructor(esc, width, height) {
    this.esc = esc;
    this.game = esc.game;
    this.W = width;
    this.H = height;
    this.scene = null;
    this.visible = true;
    this.hover = null; // EscObject under the mouse
    this.hoverButton = null;
    this.pressedVerb = ""; // verbs_menu: the highlighted button
    this.selectedAction = ""; // verbs_menu.selected_action
    this.target = "";
    this.target2 = "";
    this.waitingTarget2 = false;
    this.speech = null;
    this.speechFont = null;
    this.chooser = null; // {dialog, options, offset, resolve, timeLeft}
    esc.actions.listeners.add(() => this.updateSentence());
  }

  async load() {
    const file = this.game.setting("escoria/ui/game_scene", "");
    if (!this.game.files[file]) return this.esc.log(`game scene ${file} wasn't exported`, "warn");
    this.scene = instantiate(this.game, file);
    for (const n of this.scene.walk()) {
      await this.game.loadImagesIn(n.props);
      for (const k of ["theme_override_fonts/font", "theme_override_fonts/normal_font"]) {
        const f = resPath(n.props[k]);
        if (f) await this.game.loadFont(f).catch(() => null); // drawn without it if it can't load
      }
    }
    this.verbsMenu = this.scene.find((n) => n.scriptName === "verbs_menu");
    this.tooltip = this.scene.find((n) => n.type === "RichTextLabel" && /tooltip|sentence/.test(n.scriptName + n.name));
    this.uiRoot = this.scene.getNode("ui/Control");
    // inventory: the ESCInventoryContainer grid inside its ScrollContainer
    this.invGrid = this.scene.find((n) => n.scriptName === "esc_inventory_container");
    this.invScroll = this.invGrid && this.invGrid.parent && this.invGrid.parent.type === "ScrollContainer" ? this.invGrid.parent : null;
    this.scrollY = 0;
    this.invOrder = []; // ids in the order they were added (container children)
    const sz = this.game.setting("escoria/ui/inventory_item_size", null);
    this.invItemSize = sz && sz.args ? { w: sz.args[0], h: sz.args[1] } : { w: 64, h: 64 };
    // speech: the theme of the dialog player (the floating dialog inherits it)
    const dp = this.scene.find((n) => n.scriptName === "esc_dialog_player");
    const theme = dp && dp.props.theme;
    this.esc.dialogTheme = theme || null; // the dialog scenes take it (game scripts ask it for fonts)
    this.esc.uiScene = this.scene; // under get_tree().root for the game's scripts
    const fontRes = theme && theme.props && resPath(theme.props.default_font);
    if (fontRes) {
      const font = await this.game.loadFont(fontRes).catch(() => null);
      if (font) this.speechFont = { res: fontRes, size: theme.props.default_font_size || font.size };
    }
    // sentence_line.gd LABELS: the verb buttons' texts, plus "Walk to"
    this.labels = { walk: "Walk to" };
    if (this.verbsMenu) for (const b of this.verbs()) this.labels[b.name] = b.props.text || b.name;
    // the game's scripts in this scene (a sentence line extending ESCTooltip...)
    this.esc.attachScripts?.(this.scene);
    this.updateSentence();
  }

  get hooks() {
    return this.esc.hooks.ui || {};
  }

  verbs() {
    return this.verbsMenu ? this.verbsMenu.children.filter((c) => c.type === "Button") : [];
  }

  // ---------------------------------------------------------------- layout

  /** Global rectangle of a Control: {x, y, w, h}. */
  rect(node) {
    const p = node.parent;
    const pr = p && CONTROL_TYPES.has(p.type) ? this.rect(p) : { x: 0, y: 0, w: this.W, h: this.H };
    const a = (k) => node.props[k] ?? 0;
    const l = pr.x + a("anchor_left") * pr.w + a("offset_left");
    const t = pr.y + a("anchor_top") * pr.h + a("offset_top");
    const r = pr.x + a("anchor_right") * pr.w + a("offset_right");
    const b = pr.y + a("anchor_bottom") * pr.h + a("offset_bottom");
    return { x: l, y: t, w: r - l, h: b - t };
  }

  visibleNode(n) {
    for (let x = n; x; x = x.parent) if (x.props.visible === false) return false;
    return true;
  }

  // ---------------------------------------------------------------- drawing

  draw(ctx, mouse) {
    if (this.scene && this.visible && this.uiRoot) {
      this.hoverButton = null;
      for (const n of this.uiRoot.walk()) {
        if (!this.visibleNode(n)) continue;
        if (n.type === "TextureRect") this.drawTexture(ctx, n);
        else if (n.type === "Button") this.drawButton(ctx, n, mouse);
        else if (n === this.tooltip) this.drawSentence(ctx, n);
        else if (n === this.invScroll) this.drawInventory(ctx);
      }
    }
    this.drawAvatarDialog(ctx);
    if (this.chooser) this.drawChooser(ctx, mouse);
  }

  drawTexture(ctx, n) {
    const tex = n.props.texture && this.game.texture(n.props.texture.$res);
    if (!tex) return;
    const r = this.rect(n);
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = smoothFor(n, smooth);
    ctx.drawImage(tex.img, r.x, r.y, tex.img.width, tex.img.height);
    ctx.imageSmoothingEnabled = smooth;
  }

  /** A control's font: {font, size, outline?, outlineColor?, lineSep?}, or null. */
  fontOf(n, key = "theme_override_fonts/font", sizeKey = "theme_override_font_sizes/font_size") {
    const res = resPath(n.props[key]);
    const f = res ? this.game.resolveFont(res, n.props[sizeKey]) : null;
    return f ? withOverrides(f, n.props, "theme_override_") : f;
  }

  // an icon tinted with a color (white icons take the button's color)
  tinted(img, color) {
    const key = `${img.src}|${color}`;
    this.tints ||= new Map();
    if (!this.tints.has(key)) {
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
      this.tints.set(key, c);
    }
    return this.tints.get(key);
  }

  // draws a resolved font's text, or its icon, with the left/top at (x, y)
  drawText(ctx, f, text, x, y, color) {
    if (f.icon) {
      const w = Math.min(f.icon.width, f.iconWidth || f.icon.width), h = (f.icon.height * w) / f.icon.width;
      const smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.tinted(f.icon, color), x, y, w, h);
      ctx.imageSmoothingEnabled = smooth;
      return;
    }
    f.font.draw(ctx, text, Math.round(x), Math.round(y), color, f.size, f);
  }

  textWidth(f, text) {
    return f.icon ? Math.min(f.icon.width, f.iconWidth || f.icon.width) : f.font.measure(text, f.size);
  }

  textHeight(f) {
    return f.icon ? (f.icon.height * this.textWidth(f, "")) / f.icon.width : f.font.lineHeightAt(f.size) + (f.lineSep || 0);
  }

  drawButton(ctx, n, mouse) {
    const r = this.rect(n);
    const text = this.game.tr(n.props.text || ""); // Button auto-translates its text
    // a Button with an icon and no text (a script set it): the icon, tinted with its icon colors
    const iconTex = !text && n.props.icon && n.props.icon.$res && this.game.texture(n.props.icon.$res);
    const f = iconTex
      ? { icon: iconTex.img, iconWidth: n.props["theme_override_constants/icon_max_width"] || iconTex.img.width }
      : this.fontOf(n);
    if (!f) return;
    const hover = mouse && mouse.x >= r.x && mouse.y >= r.y && mouse.x < r.x + r.w && mouse.y < r.y + r.h;
    if (hover) this.hoverButton = n;
    const pressed = this.verbsMenu && n.parent === this.verbsMenu && this.pressedVerb === n.name;
    const kind = f.icon && iconTex ? "icon" : "font";
    const c = (k) => n.props[`theme_override_colors/${kind}_${k}`] || (kind === "icon" && n.props[`theme_override_colors/font_${k.replace("normal_", "")}`]);
    const col = (pressed && hover && c("hover_pressed_color")) || (pressed && c("pressed_color")) || (hover && c("hover_color")) || c(kind === "icon" ? "normal_color" : "color") || c("color");
    const w = this.textWidth(f, text);
    const align = n.props.alignment ?? 1; // 0 left, 1 center, 2 right
    const x = align === 0 ? r.x : align === 2 ? r.x + r.w - w : r.x + (r.w - w) / 2;
    const y = r.y + (r.h - this.textHeight(f)) / 2;
    this.drawText(ctx, f, text, x, y, col ? cssColor(col) : "#fff");
  }

  drawSentence(ctx, n) {
    const f = this.fontOf(n, "theme_override_fonts/normal_font", "theme_override_font_sizes/normal_font_size");
    if (!f || !this.sentence) return;
    const r = this.rect(n);
    const w = this.textWidth(f, this.sentence);
    this.drawText(ctx, f, this.sentence, r.x + (r.w - w) / 2, r.y, n.props.color ? cssColor(n.props.color) : "#fff");
  }

  // ---------------------------------------------------------------- sentence line

  updateSentence() {
    if (this.hooks.sentence) {
      this.sentence = this.hooks.sentence(this);
      return;
    }
    // ESCTooltip: verb, target, "with", second target
    const am = this.esc.actions;
    if (am.state !== STATE.AWAITING_TARGET_ITEM && am.state !== STATE.COMPLETED) {
      this.waitingTarget2 = false;
      this.target2 = "";
    }
    const tr = (s) => this.game.tr(s);
    const verb = am.currentAction ? tr(this.labels[am.currentAction] || am.currentAction) : "";
    this.sentence = [verb, tr(this.target), this.waitingTarget2 || this.target2 ? tr("with") : "", tr(this.target2)].filter(Boolean).join(" ");
  }

  setTarget(name, needsSecond = false) {
    this.target = name;
    this.waitingTarget2 = needsSecond;
    this.updateSentence();
  }

  setTarget2(name) {
    this.target2 = name;
    this.updateSentence();
  }

  clearTooltip() {
    this.waitingTarget2 = false;
    this.setTarget("");
    this.setTarget2("");
  }

  // ---------------------------------------------------------------- verbs menu

  onActionSelected(action) {
    if (this.esc.inputMode !== "ALL") return (this.pressedVerb = "");
    this.esc.actions.setCurrentAction(action);
    this.pressedVerb = action;
    this.selectedAction = action;
  }

  setByName(action) {
    this.selectedAction = action;
    this.pressedVerb = action;
  }

  // ---------------------------------------------------------------- input (game.gd)

  /** The interactive item under a room point (Escoria's hover stack: highest z_index). */
  itemAt(p) {
    let hit = null;
    for (const o of this.esc.objects.values()) {
      const n = o.node;
      if (!isItem(n) || !o.interactive || !o.active || n.props.is_trigger || n === this.esc.player?.node) continue;
      if (!itemShapes(n).some((s) => inside(p, s.pts.map((q) => apply(s.xf, q))))) continue;
      if (!hit || (n.props.z_index || 0) >= (hit.node.props.z_index || 0)) hit = o;
    }
    return hit;
  }

  /**
   * The mouse moved: `screen` (canvas coordinates) and `room` (room
   * coordinates), both null when it left. Focuses room items
   * (element_focused) or inventory items (inventory_item_focused).
   */
  pointerMove(screen, room) {
    let obj = null, inInventory = false;
    if (screen && this.overPanel(screen.x, screen.y)) {
      obj = this.inventoryItemAt(screen);
      inInventory = !!obj;
    } else if (room) obj = this.itemAt(room);
    if (obj === this.hover) return;
    this.hover = obj;
    this.esc.setHovered(obj);
    const am = this.esc.actions;
    if (am.state === STATE.COMPLETED) return;
    if (obj) {
      const name = obj.node.props.tooltip_name || "";
      if (am.state === STATE.AWAITING_TARGET_ITEM) this.setTarget2(name);
      else {
        this.setTarget(name);
        // hovering highlights the default action (not over "use" in the inventory)
        if (!inInventory || am.currentAction !== "use") this.setByName(obj.node.props.default_action || "");
      }
    } else if (am.state === STATE.AWAITING_TARGET_ITEM) this.setTarget2("");
    else {
      this.setTarget("");
      this.pressedVerb = am.currentAction;
    }
  }

  /** Is (x, y) (screen) over the visible UI panel? */
  overPanel(x, y) {
    if (!this.visible || !this.uiRoot) return false;
    const panel = this.uiRoot.children.find((c) => c.name === "panel_down") || this.uiRoot;
    const r = this.rect(panel);
    return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  }

  /** A click on the UI panel (screen coordinates; button 0 left, 2 right). Returns true if used. */
  clickPanel(x, y, button = 0) {
    if (!this.overPanel(x, y)) return false;
    const esc = this.esc, am = esc.actions;
    const b = this.hoverButton;
    if (b && this.verbsMenu && b.parent === this.verbsMenu) {
      if (button === 0) this.onActionSelected(b.name);
      return true;
    }
    const obj = this.inventoryItemAt({ x, y });
    if (!obj || esc.inputMode !== "ALL" || esc.state !== "DEFAULT") return true;
    if (button === 2) {
      // right_click_on_inventory_item
      am.setCurrentAction(this.selectedAction);
      am.itemClick(obj.globalId, { position: obj.position }, false);
      return true;
    }
    // left_click_on_inventory_item; a game that patched it in game.gd does its
    // part first (esc.hooks.inventoryLeftClick: it can change the action)
    if (esc.hooks.inventoryLeftClick) {
      const before = am.currentAction;
      esc.hooks.inventoryLeftClick(obj, am);
      if (am.currentAction !== before) this.pressedVerb = am.currentAction;
    }
    am.itemClick(obj.globalId, { position: obj.position }, false);
    if (am.state === STATE.AWAITING_TARGET_ITEM) this.setTarget(obj.node.props.tooltip_name || "", true);
    return true;
  }

  /** Clicks in the room: button 0 left, 2 right; p in room coordinates. */
  clickRoom(p, button, doubleClick) {
    const esc = this.esc, am = esc.actions;
    if (esc.inputMode !== "ALL" || esc.state !== "DEFAULT") return;
    const obj = this.itemAt(p);
    const event = { position: p, doubleClick };
    if (!obj) {
      // left_click_on_bg / right_click_on_bg / left_double_click_on_bg
      if (!esc.player) return;
      am.backgroundClick(esc.player.globalId, p, doubleClick);
      if (!doubleClick) am.clearCurrentTool();
      am.clearCurrentAction();
      this.clearTooltip();
      this.pressedVerb = "";
      return;
    }
    if (button === 2) {
      // right_click_on_item: the verb shown, else the item's default action
      let verb = am.currentAction || this.selectedAction || obj.node.props.default_action || "";
      if (!verb) return;
      am.setCurrentAction(verb);
      am.itemClick(obj.globalId, event);
      return;
    }
    am.itemClick(obj.globalId, event);
    if (am.state === STATE.COMPLETED) return;
    const name = obj.node.props.tooltip_name || "";
    if (am.state === STATE.AWAITING_TARGET_ITEM) this.setTarget(name, true);
    else this.setTarget(name);
  }

  // ---------------------------------------------------------------- inventory

  /** Keeps the grid in step with the inventory (items added at the end). */
  syncInventory() {
    const have = this.esc.inventory.items();
    this.invOrder = this.invOrder.filter((id) => have.includes(id));
    for (const id of have) if (!this.invOrder.includes(id) && this.esc.inventoryObject(id)) this.invOrder.push(id);
    this.scrollY = Math.min(this.scrollY, this.maxScroll());
  }

  // GridContainer layout: columns, separations, item size
  gridCell(i) {
    const g = this.invGrid.props;
    const cols = g.columns || 1;
    const hs = g["theme_override_constants/h_separation"] ?? 4;
    const vs = g["theme_override_constants/v_separation"] ?? 4;
    const { w, h } = this.invItemSize;
    return { x: (i % cols) * (w + hs), y: Math.floor(i / cols) * (h + vs), w, h };
  }

  /** Scrolls the inventory's ScrollContainer by dy px. */
  scrollInventory(dy) {
    this.scrollY = Math.min(Math.max(this.scrollY + dy, 0), this.maxScroll());
  }

  maxScroll() {
    if (!this.invScroll || !this.invOrder.length) return 0;
    const last = this.gridCell(this.invOrder.length - 1);
    return Math.max(0, last.y + last.h - this.rect(this.invScroll).h);
  }

  /** {obj, rect} of the inventory item at screen point s, or null. */
  inventoryItemAt(s) {
    if (!this.invScroll || !s) return null;
    const box = this.rect(this.invScroll);
    if (s.x < box.x || s.y < box.y || s.x >= box.x + box.w || s.y >= box.y + box.h) return null;
    for (let i = 0; i < this.invOrder.length; i++) {
      const c = this.gridCell(i);
      const x = box.x + c.x, y = box.y + c.y - this.scrollY;
      if (s.x >= x && s.y >= y && s.x < x + c.w && s.y < y + c.h) return this.esc.inventoryObject(this.invOrder[i]);
    }
    return null;
  }

  drawInventory(ctx) {
    this.syncInventory();
    const box = this.rect(this.invScroll);
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    this.invOrder.forEach((id, i) => {
      const obj = this.esc.inventoryObject(id);
      const c = this.gridCell(i);
      const hovered = this.hover === obj;
      const res = (hovered && obj.node.props.inventory_texture_hovered) || obj.node.props.inventory_texture;
      const tex = res && this.game.texture(res.$res);
      if (!tex) return;
      const img = tex.img;
      const w = img.width, h = img.height;
      // TextureButton STRETCH_KEEP_ASPECT: fit inside the cell, keeping proportions
      const k = Math.min(c.w / w, c.h / h);
      const smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = smoothFor(obj.node, smooth);
      ctx.drawImage(img, box.x + c.x, box.y + c.y - this.scrollY, w * k, h * k);
      ctx.imageSmoothingEnabled = smooth;
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------- dialog choices

  /** Shows the options of a `?!` dialog; resolves with the chosen one (or null). */
  chooseDialogOption(dialog) {
    return new Promise((resolve) => {
      const options = dialog.options;
      if (!options.length) return resolve(null);
      const ext = this.hooks.chooser;
      if (ext && ext.active()) {
        // the game's chooser: its buttons are Controls of its scene
        this.chooser = { external: true, dialog, options, resolve };
        ext.show(dialog, (o) => this.chooser && this.choose(o));
        return;
      }
      // simple.gd show_chooser(): the avatar scene (dialog.avatar, "-" for none) in AvatarContainer
      let avatar = null;
      if (dialog.avatar && dialog.avatar !== "-" && this.game.files[dialog.avatar]) {
        avatar = instantiate(this.game, dialog.avatar);
        for (const n of avatar.walk()) this.game.loadImagesIn(n.props);
      }
      const timeout = dialog.timeout > 0 && dialog.timeoutOption ? dialog.timeout : 0;
      this.chooser = { dialog, options, offset: 0, resolve, timeLeft: timeout, timeout, avatar };
    });
  }

  choose(option) {
    const c = this.chooser;
    this.chooser = null;
    c.resolve(option);
  }

  /** The chooser's lines as buttons: [{text, x, y, w, h, color, hover, option}] */
  // escoria-dialog-simple chooser/simple.tscn: flat Buttons in a VBoxContainer
  // (separation 20) inside a MarginContainer at 20, 20 with margins of 20,
  // in the dialog theme's font; color_normal white, color_hover
  // Color(165, 42, 42) (over 1: shown as white)
  chooserFont() {
    const th = this.esc.dialogTheme && this.esc.dialogTheme.props;
    const fr = th && resPath(th.default_font);
    return fr ? this.game.resolveFont(fr, th.default_font_size || 16) : null;
  }

  chooserButtons() {
    const c = this.chooser, f = this.chooserFont();
    const lh = f ? f.font.lineHeightAt(f.size) : 34;
    const h = lh + 8; // a flat Button: the text and its content margins
    // the Buttons fill the container's width (40 to the screen's right edge), text centered
    return c.options.map((o, i) => {
      const text = this.game.tr(String(o.text));
      const tw = f ? f.font.measure(text, f.size) : 600;
      return { text, tw, x: 40, y: 40 + i * (h + 20), w: this.W - 40, h, color: "#fff", hover: "#fff", option: o };
    });
  }

  drawChooser(ctx, mouse) {
    const c = this.chooser;
    if (!c || c.external) return;
    const f = this.chooserFont();
    for (const b of this.chooserButtons()) {
      const hover = mouse && mouse.x >= b.x && mouse.y >= b.y && mouse.x < b.x + b.w && mouse.y < b.y + b.h;
      if (f) f.font.draw(ctx, b.text, Math.round(b.x + (b.w - b.tw) / 2), b.y + 4, hover ? b.hover : b.color, f.size, f);
      else {
        ctx.font = "30px system-ui, sans-serif";
        ctx.textBaseline = "top";
        ctx.fillStyle = hover ? b.hover : b.color;
        ctx.fillText(b.text, b.x, b.y);
        ctx.textBaseline = "alphabetic";
      }
    }
    // (TimerProgress isn't seen in Godot: not drawn; the timeout still chooses)
    // AvatarContainer at (94, 68)
    if (c.avatar) {
      draw(ctx, this.game, collect(c.avatar, [1, 0, 0, 1, 94, 68]));
    }
  }

  clickChooser(s) {
    if (this.chooser && this.chooser.external) return;
    for (const b of this.chooserButtons()) {
      if (s.x < b.x || s.y < b.y || s.x >= b.x + b.w || s.y >= b.y + b.h) continue;
      return this.choose(b.option);
    }
  }

  // ---------------------------------------------------------------- speech

  say(obj, text, cmd, key = "", type = "") {
    // dialog_say.gd: the translation of the key, if it has one; then floating.gd tr(line)
    if (key && this.game.tr(key) !== key) text = this.game.tr(key);
    text = this.game.tr(text);
    const set = (k, d) => this.game.setting(`escoria/dialog_simple/${k}`, d);
    // esc_dialog_simple.gd _init_type_player(): "floating", anything else is "avatar"
    type = type || this.game.setting("escoria/ui/default_dialog_type", "floating");
    return new Promise((done) => {
      const color = obj.node.props.dialog_color ? cssColor(obj.node.props.dialog_color) : "#fff";
      let secs, ext = null;
      const d = this.hooks.dialog;
      const speech = { obj, text, color, done, cmd, shown: text.length, typing: false };
      if (d && d.active()) {
        // the game's floating dialog script: how long, and where it goes
        ext = d.say(obj, text, cmd);
        secs = ext.secs;
      } else {
        // floating.gd / avatar.gd: typed at text_time_per_letter_ms, then shown
        // for its words at reading_speed_in_wpm
        const wpm = set("reading_speed_in_wpm", 200);
        secs = (text.split(/\s+/).filter(Boolean).length * 60) / wpm;
        speech.perLetter = Math.max(0, set("text_time_per_letter_ms", 100)) / 1000;
        speech.fastLetter = Math.max(0, set("text_time_per_fast_letter_ms", 25)) / 1000;
        speech.typing = speech.perLetter > 0 && text.length > 0;
        speech.shown = speech.typing ? 0 : text.length;
        speech.byClickOnly = !!set("clear_text_by_click_only", false);
        if (type !== "floating") speech.avatar = this.avatarOf(obj);
      }
      Object.assign(speech, { left: secs, dialog: ext && ext.dialog, type });
      this.speech = speech;
    });
  }

  /** A click while someone talks (dialog_simple left_click_action). */
  clickSpeech() {
    const s = this.speech;
    if (!s || this.esc.inputMode === "NONE") return;
    if (s.typing) {
      const action = this.game.setting("escoria/dialog_simple/left_click_action", "Speed up");
      if (action === "Speed up") s.perLetter = s.fastLetter; // speedup()
      else if (action === "Instant finish") s.shown = s.text.length;
      return;
    }
    this.endSpeech();
  }

  // avatar.gd set_current_character(): <avatars_path>/<global_id>.tres (an AnimatedTexture or a texture)
  avatarOf(obj) {
    const dir = String(this.game.setting("escoria/dialog_simple/avatars_path", "")).replace(/\/$/, "");
    const file = `${dir}/${obj.globalId}.tres`;
    if (!dir || !this.game.files[file]) return null;
    const res = this.game.resource(file);
    this.game.loadImagesIn(res.props);
    const p = res.props;
    if (res.type !== "AnimatedTexture") return { frames: [{ texture: p.texture || res, duration: 1 }], t: 0 };
    const frames = [];
    for (let i = 0; i < (p.frames ?? 1); i++) frames.push({ texture: p[`frame_${i}/texture`], duration: p[`frame_${i}/duration`] ?? 1 });
    return { frames, t: 0, speed: p.speed_scale ?? 1 };
  }

  endSpeech() {
    if (!this.speech) return false;
    const s = this.speech;
    this.speech = null;
    if (s.dialog) this.hooks.dialog.finished(s);
    s.done();
    return true;
  }

  update(dt) {
    dt *= this.esc.timeScale;
    const c = this.chooser;
    if (c && c.timeLeft > 0) {
      c.timeLeft -= dt;
      if (c.timeLeft <= 0) this.choose(c.options[c.dialog.timeoutOption - 1] || null);
    }
    const s = this.speech;
    if (s) {
      if (s.typing) {
        // the line is typed (visible_ratio), the avatar plays meanwhile
        s.shown = s.perLetter > 0 ? s.shown + dt / s.perLetter : s.text.length;
        if (s.avatar) s.avatar.t += dt * (s.avatar.speed || 1);
        if (s.shown >= s.text.length) {
          s.shown = s.text.length;
          s.typing = false; // _on_dialog_line_typed(): the avatar stops on its first frame
          if (s.avatar) s.avatar.t = 0;
        }
      } else if (!s.byClickOnly) s.left -= dt;
      if (s.left <= 0 || (s.cmd && s.cmd.interrupted) || (s.dialog && this.hooks.dialog?.ended?.(s))) this.endSpeech();
    }
  }

  drawSpeech(ctx, cam) {
    const sp = this.speech;
    if (!sp || (sp.type && sp.type !== "floating" && !sp.dialog)) return; // avatar: drawAvatarDialog()
    const n = sp.obj.node;
    const dl = n.children.find((c) => c.scriptName === "esc_dialog_location");
    const p = apply(multiply(cam, globalTransform(dl || n)), { x: 0, y: 0 });
    let measure, lineH, drawLine;
    const placed = sp.dialog && this.hooks.dialog.layout(sp); // the game's script placed it
    // the dialog theme as it is now (a game script can change its font)
    const th = this.esc.dialogTheme && this.esc.dialogTheme.props;
    const themeFont = th && resPath(th.default_font);
    let sf = themeFont ? this.game.resolveFont(themeFont, th.default_font_size || (this.speechFont && this.speechFont.size)) : this.speechFont && this.game.resolveFont(this.speechFont.res, this.speechFont.size);
    if (sf && th) sf = withOverrides(sf, th, "RichTextLabel/");
    // the dialog node's own font, size and outline (theme overrides its script set)
    const np = placed && placed.props;
    const ownFont = np && resPath(np["theme_override_fonts/normal_font"]);
    if (ownFont) {
      const f = this.game.resolveFont(ownFont, np["theme_override_font_sizes/normal_font_size"] || 16);
      if (f) sf = withOverrides(f, np, "theme_override_");
    }
    if (sf) {
      const f = sf;
      measure = (s) => f.font.measure(s, f.size);
      lineH = f.font.lineHeightAt(f.size) + (f.lineSep || 0);
      drawLine = (s, x, y) => f.font.draw(ctx, s, x, y, sp.color, f.size, f);
    } else {
      ctx.font = "bold 30px system-ui, sans-serif";
      ctx.textBaseline = "top";
      measure = (s) => ctx.measureText(s).width;
      lineH = 34;
      drawLine = (s, x, y) => {
        ctx.lineWidth = 6;
        ctx.strokeStyle = "#000";
        ctx.strokeText(s, x, y);
        ctx.fillStyle = sp.color;
        ctx.fillText(s, x, y);
      };
    }
    // floating.gd: its label (floating.tscn's width) centered on the
    // ESCDialogLocation; without one, across the whole screen at the top
    const W = this.W, H = this.H, x = p.x;
    const sceneW = this.floatingWidth();
    const w = placed ? placed.w : !dl ? W : sceneW ? Math.min(sceneW, W) : Math.min(measure(sp.text) + 2, W);
    // the script's text (its own line breaks), else the line said
    const lines = placed && placed.text != null ? placed.text.split("\n").flatMap((l) => wrapText(l, w, measure)) : wrapText(sp.text, w, measure);
    const h = lines.length * lineH;
    placed?.setHeight?.(h);
    let left = !dl && !placed ? 0 : x - w / 2, top = !dl && !placed ? 0 : p.y;
    if (placed && placed.pos) [left, top] = [placed.pos.x, placed.pos.y];
    if (left < 0) left = 0;
    if (left + w > W) left -= left + w - W;
    if (top < 0) top = 0;
    if (top + h > H) top -= top + h - H;
    let rest = Math.floor(sp.shown ?? sp.text.length);
    lines.forEach((l, i) => {
      // typed so far (the layout is the whole line's, as with visible_ratio)
      const part = l.slice(0, Math.max(0, rest));
      rest -= l.length + 1;
      if (part) drawLine(part, Math.round(left + (w - measure(l)) / 2), Math.round(top + i * lineH));
    });
    ctx.textBaseline = "alphabetic";
  }

  // the width of escoria-dialog-simple's floating.tscn label (643), if exported
  floatingWidth() {
    if (this._floatingW === undefined) {
      const doc = this.game.files["res://addons/escoria-dialog-simple/types/floating.tscn"];
      const root = doc && doc.nodes && doc.nodes[0];
      const p = root && root.props;
      this._floatingW = p && p.offset_right ? p.offset_right - (p.offset_left || 0) : 0;
    }
    return this._floatingW;
  }

  // avatar.tscn: a 510x180 window in the middle of the screen; Panel,
  // margins of 20, the avatar (0.3 of the width) and the text, 35 apart
  drawAvatarDialog(ctx) {
    const sp = this.speech;
    if (!sp || sp.type === "floating" || sp.dialog) return;
    const w = 510, h = 180, x = Math.round((this.W - w) / 2), y = Math.round((this.H - h) / 2);
    ctx.fillStyle = "rgba(38, 38, 38, 0.95)";
    ctx.fillRect(x, y, w, h);
    const inner = w - 40 - 35, aw = Math.round((inner * 0.3) / 1.3), tw = inner - aw;
    const a = sp.avatar;
    if (a && a.frames.length) {
      // the frame for the time it has played (AnimatedTexture loops)
      const total = a.frames.reduce((t, f) => t + f.duration, 0) || 1;
      let t = a.t % total, f = a.frames[0];
      for (const fr of a.frames) {
        if (t < fr.duration) { f = fr; break; }
        t -= fr.duration;
      }
      const tex = this.game.texture(f.texture);
      if (tex) {
        const k = Math.min(aw / tex.sw, (h - 40) / tex.sh); // STRETCH_KEEP_ASPECT
        const smooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tex.img, tex.sx, tex.sy, tex.sw, tex.sh, x + 20, y + 20, tex.sw * k, tex.sh * k);
        ctx.imageSmoothingEnabled = smooth;
      }
    }
    const th = this.esc.dialogTheme && this.esc.dialogTheme.props;
    const fr = th && resPath(th.default_font);
    const f = fr && this.game.resolveFont(fr, th.default_font_size || 16);
    const tx = x + 20 + aw + 35, ty = y + 20;
    if (!f) return;
    const measure = (s) => f.font.measure(s, f.size), lh = f.font.lineHeightAt(f.size);
    let rest = Math.floor(sp.shown ?? sp.text.length);
    wrapText(sp.text, tw, measure).forEach((l, i) => {
      const part = l.slice(0, Math.max(0, rest));
      rest -= l.length + 1;
      if (part && ty + (i + 1) * lh <= y + h - 20) f.font.draw(ctx, part, tx, ty + i * lh, sp.color, f.size, f);
    });
  }
}

/**
 * A resolved font with the outline and line spacing a control's overrides
 * (prefix "theme_override_") or a theme's type (prefix "RichTextLabel/") give.
 */
export function withOverrides(f, props, prefix) {
  const o = props[`${prefix}constants/outline_size`];
  const ls = props[`${prefix}constants/line_separation`] ?? props[`${prefix}constants/line_spacing`];
  if (!o && ls === undefined) return f;
  const out = { ...f };
  if (o) {
    out.outline = o;
    out.outlineColor = cssColor(props[`${prefix}colors/font_outline_color`] || { type: "Color", args: [0, 0, 0, 1] });
  }
  if (ls !== undefined) out.lineSep = ls;
  return out;
}

/** Do two items' collision shapes overlap (a vertex of one inside the other)? */
export function shapesOverlap(a, b) {
  const pa = itemShapes(a).map((s) => s.pts.map((q) => apply(s.xf, q)));
  const pb = itemShapes(b).map((s) => s.pts.map((q) => apply(s.xf, q)));
  return pa.some((x) => pb.some((y) => x.some((q) => inside(q, y)) || y.some((q) => inside(q, x))));
}

/** The res:// path of a resource prop: {"$res"} or a loaded .tres ({path}). */
export const resPath = (v) => (v && (v.$res || v.path)) || null;

export function itemShapes(item) {
  const out = [];
  for (const c of item.children) {
    if (c.props.disabled) continue;
    if (c.type === "CollisionPolygon2D") out.push({ xf: globalTransform(c), pts: points(c.props.polygon) });
    else if (c.type === "CollisionShape2D" && c.props.shape) {
      const pts = shapePoints(c.props.shape);
      if (pts) out.push({ xf: globalTransform(c), pts });
    }
  }
  return out;
}

// a RectangleShape2D, CircleShape2D or CapsuleShape2D (vertical) as a polygon
function shapePoints(shape) {
  const p = shape.props || {};
  if (shape.type === "RectangleShape2D") {
    const s = vec2(p.size, 20, 20);
    return [{ x: -s.x / 2, y: -s.y / 2 }, { x: s.x / 2, y: -s.y / 2 }, { x: s.x / 2, y: s.y / 2 }, { x: -s.x / 2, y: s.y / 2 }];
  }
  if (shape.type === "CircleShape2D" || shape.type === "CapsuleShape2D") {
    const r = p.radius ?? 10;
    const half = shape.type === "CapsuleShape2D" ? Math.max((p.height ?? 30) / 2 - r, 0) : 0;
    const pts = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 2 * Math.PI;
      const y = Math.sin(a) * r;
      pts.push({ x: Math.cos(a) * r, y: y + (y >= 0 ? half : -half) });
    }
    return pts;
  }
  return null;
}

export function inside(p, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

export { readColor };
