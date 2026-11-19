// The escoria-ui-simplemouse game scene (addons/escoria-ui-simplemouse/):
// game.gd, verbs_mouseicons.gd (the verb is the mouse cursor; the wheel
// changes it), inventory/inventory_ui.gd (a panel at the bottom that slides up
// when the mouse reaches its title) and tooltip/tooltip_target.gd (the
// target's name next to the mouse). Escoria, MIT license, (c) Godot Escoria
// contributors.
//
// Speech, the dialog chooser and the inventory items come from GameUI.
import { GameUI, resPath } from "./game_ui.js";
import { ScriptedGameUI, isScripted } from "./scripted_ui.js";
import { STATE } from "../actions.js";
import { cssColor } from "../../godot/values.js";

const SCRIPT = "addons/escoria-ui-simplemouse/game.gd";
const VERB_USE = "use";
const VERB_WALK = "walk";
const TITLE_HEIGHT = 34; // inventory_ui.gd _inventory_title_height
const SLIDE_SECS = 0.4;
const CURSOR_HOTSPOT = 32; // verbs_mouseicons.gd set_custom_mouse_cursor(..., Vector2(32,32))

/** Is the game scene file simplemouse's game.gd? */
export function isSimpleMouse(game) {
  const file = game.setting("escoria/ui/game_scene", "");
  const root = game.files[file] && game.files[file].nodes && game.files[file].nodes[0];
  const script = root && root.props && root.props.script && root.props.script.$res;
  return !!script && script.endsWith(SCRIPT);
}

/** The game scene's UI: the game's own (its script translated), simplemouse's or the 9-verbs one. */
export function createGameUI(esc, width, height) {
  if (isScripted(esc)) return ScriptedGameUI.create(esc, width, height);
  return isSimpleMouse(esc.game) ? SimpleMouseUI.create(esc, width, height) : GameUI.create(esc, width, height);
}

export class SimpleMouseUI extends GameUI {
  static async create(esc, width, height) {
    const ui = new SimpleMouseUI(esc, width, height);
    await ui.load();
    return ui;
  }

  async load() {
    await super.load();
    if (!this.scene) return;
    const mouseIcons = this.scene.find((n) => n.scriptName === "verbs_mouseicons");
    const actions = mouseIcons && mouseIcons.getNode("actions");
    this.cursors = actions ? actions.children.map((c) => ({ name: c.name, texture: c.props.texture })) : [];
    this.cursorId = 0;
    this.manuallyChanged = false; // verbs_menu.action_manually_changed
    this.toolTexture = null; // verbs_menu $mouse_position/tool
    this.verbsMenu = null; // GameUI's verb buttons: none here
    this.tooltip = this.scene.find((n) => n.scriptName === "tooltip_target");
    this.tooltipTarget = "";
    this.panel = this.scene.getNode("ui/inventory_ui/panel");
    this.panelH = this.panel ? this.panel.props.offset_bottom - this.panel.props.offset_top : 0;
    this.panelY = this.H - TITLE_HEIGHT; // hide_inventory() in _ready
    this.panelFrom = this.panelY;
    this.panelTo = this.panelY;
    this.panelT = 1;
    this.inventoryOpen = false;
    const label = this.panel && this.panel.getNode("Label");
    this.label = label;
    const sep = this.invGrid && this.invGrid.props["theme_override_constants/separation"];
    this.invSeparation = sep ?? 4;
    this.menuButton = this.scene.getNode("ui/HBoxContainer/VBoxContainer/MenuButton");
    // game.gd _ready(): hide_ui(); hide_main_menu() / unpause_game() show it
    this.uiShown = false;
    this.esc.hooks.menusClosed = () => (this.uiShown = true);
    this.lastInputMode = this.esc.inputMode;
    this.lastRoom = null;
    this.mouse = null;
    this.setByName(VERB_WALK);
    // ESCGame: event_manager.event_finished -> _on_event_done
    this.esc.events.listeners.push((rc) => this.onEventDone(rc));
  }

  // ---------------------------------------------------------------- verbs_mouseicons.gd

  /** set_by_name(): the cursor, and the current action (or force_verb). */
  setByName(name, forceVerb = "") {
    const i = this.cursors.findIndex((c) => c.name === name);
    if (i >= 0) this.cursorId = i;
    const c = this.cursors[this.cursorId];
    if (!c) return;
    this.esc.actions.setCurrentAction(forceVerb || c.name);
  }

  iterateActionsCursor(direction) {
    let i = this.cursorId + direction;
    if (i > 4) i = 0;
    else if (i < 0) i = 4;
    this.cursorId = i;
    this.setByName(this.cursors[i].name);
    if (this.toolTexture) this.toolTexture = null;
    this.manuallyChanged = true;
  }

  /** CSS cursor of the current verb (Input.set_custom_mouse_cursor). */
  get cursor() {
    const c = this.cursors && this.cursors[this.cursorId];
    if (!c || !c.texture || !this.uiShown) return "";
    return `url("${this.game.url(c.texture.$res)}") ${CURSOR_HOTSPOT} ${CURSOR_HOTSPOT}, auto`;
  }

  // ---------------------------------------------------------------- tooltip (ESCTooltip)

  setTarget(name) {
    this.tooltipTarget = name || "";
  }
  setTarget2() {}
  clearTooltip() {
    this.tooltipTarget = "";
  }
  updateSentence() {}

  // ---------------------------------------------------------------- game.gd

  elementFocused(obj) {
    const am = this.esc.actions;
    this.setTarget(obj.node.props.tooltip_name);
    if (am.currentAction !== VERB_USE && !am.currentTool) {
      if (obj.node.props.is_exit) {
        if (obj.globalId.includes("_l_")) this.setByName("exit_left", VERB_WALK);
        else if (obj.globalId.includes("_r_")) this.setByName("exit_right", VERB_WALK);
        else this.setByName(VERB_WALK);
      } else if (!this.manuallyChanged) this.setByName(obj.node.props.default_action || "");
    }
  }

  elementUnfocused() {
    this.setTarget("");
    if (!this.manuallyChanged) this.setByName(VERB_WALK);
  }

  inventoryItemFocused(obj) {
    if (this.manuallyChanged) return;
    this.setTarget(obj.node.props.tooltip_name);
    this.setByName(obj.node.props.default_action_inventory || "");
  }

  inventoryItemUnfocused() {
    const am = this.esc.actions;
    this.clearTooltip();
    if (am.currentAction === VERB_WALK) {
      this.setByName(VERB_WALK);
      this.manuallyChanged = false;
    } else if (!this.manuallyChanged && !am.currentTool) this.setByName(VERB_WALK);
  }

  onEventDone(rc) {
    // input_mode_changed is a signal in Escoria (handled at once): a mode
    // changed during the event (accept_input in a spawned scene's _ready)
    // must not overwrite what event_done sets
    this.syncInputMode();
    if (rc !== 0) return; // RC_OK
    this.esc.actions.clearCurrentAction();
    this.setTarget("");
    this.setByName(VERB_WALK);
  }

  /** _on_input_mode_changed */
  syncInputMode() {
    const esc = this.esc;
    if (esc.inputMode === this.lastInputMode) return;
    this.lastInputMode = esc.inputMode;
    if (esc.inputMode === "NONE") this.setByName("wait");
    else if (esc.actions.state !== STATE.AWAITING_TARGET_ITEM) this.setByName(esc.actions.currentAction);
  }

  // _on_action_finished / _on_room_ready
  resetVerb() {
    this.toolTexture = null;
    this.setByName(VERB_WALK);
    this.manuallyChanged = false;
  }

  // ---------------------------------------------------------------- inventory_ui.gd

  slideTo(y) {
    if (this.panelTo === y) return;
    this.panelFrom = this.panelY;
    this.panelTo = y;
    this.panelT = 0;
  }
  openInventory() {
    this.inventoryOpen = true;
    this.slideTo(this.H - this.panelH);
  }
  closeInventory() {
    this.inventoryOpen = false;
    this.slideTo(this.H - TITLE_HEIGHT);
  }

  // the items' box: panel/MarginContainer (y 34, margins 20)/ScrollContainer
  itemsBox() {
    const m = this.panel.getNode("MarginContainer");
    const p = m.props, k = (s) => p[`theme_override_constants/margin_${s}`] || 0;
    const x = (p.offset_left || 0) + k("left"), y = this.panelY + (p.offset_top || 0) + k("top");
    return { x, y, w: (p.offset_right || this.W) - (p.offset_left || 0) - k("left") - k("right"), h: (p.offset_bottom || 0) - (p.offset_top || 0) - k("top") - k("bottom") };
  }

  // HBoxContainer: one row, `separation` between items
  gridCell(i) {
    const { w, h } = this.invItemSize;
    return { x: i * (w + this.invSeparation), y: 0, w, h };
  }

  inventoryItemAt(s) {
    if (!this.panel || !s || !this.uiShown) return null;
    this.syncInventory();
    const box = this.itemsBox();
    for (let i = 0; i < this.invOrder.length; i++) {
      const c = this.gridCell(i);
      const x = box.x + c.x, y = box.y + c.y;
      if (s.x >= x && s.y >= y && s.x < x + c.w && s.y < y + c.h) return this.esc.inventoryObject(this.invOrder[i]);
    }
    return null;
  }

  maxScroll() {
    return 0;
  }

  // ui/HBoxContainer/VBoxContainer: the Menu button and, with
  // escoria/debug/enable_room_selector, the room selector (room_select.tscn:
  // an OptionButton with the folders of debug/room_selector_room_dir and "Go")
  buttonsLayout() {
    const b = this.menuButton, f = this.buttonFont();
    if (!b || !f) return null;
    const pad = 16, h = this.textHeight(f) + 8, gap = 4;
    const box = this.scene.getNode("ui/HBoxContainer").props;
    const x = box.offset_left || 0, y = box.offset_top || 0;
    const rooms = this.roomList();
    let w = this.textWidth(f, this.game.tr(b.props.text || "")) + pad;
    const out = {};
    if (rooms.length) {
      const optW = Math.max(...rooms.map((r) => this.textWidth(f, r.name))) + pad + 20;
      const goW = this.textWidth(f, "Go") + pad;
      w = Math.max(w, optW + gap + goW);
      out.option = { x, y: y + h + gap, w: w - goW - gap, h };
      out.go = { x: x + w - goW, y: y + h + gap, w: goW, h };
      if (this.roomListOpen) {
        // the OptionButton's PopupMenu: below the button, moved up to fit in the screen;
        // a radio mark before each item
        const lw = Math.max(out.option.w, ...rooms.map((r) => this.textWidth(f, r.name) + 36));
        let top = out.option.y + h;
        if (top + rooms.length * h > this.H) top = this.H - rooms.length * h;
        if (top < 0) top = 0;
        out.list = rooms.map((r, i) => ({ x, y: top + i * h, w: lw, h, index: i }));
      }
    }
    out.menu = { x, y, w, h };
    return out;
  }

  roomList() {
    if (this.rooms) return this.rooms;
    this.rooms = [];
    if (!this.game.setting("escoria/debug/enable_room_selector", false)) return this.rooms;
    const dir = String(this.game.setting("escoria/debug/room_selector_room_dir", "")).replace(/\/$/, "");
    if (!dir) return this.rooms;
    // room_select.gd: every folder of the rooms dir (as <dir>/<name>/<name>.tscn, even if
    // that file doesn't exist: "intro" has intro_room.tscn)
    const names = new Set();
    for (const f of [...Object.keys(this.game.files), ...Object.keys(this.game.scripts || {}), ...(this.game.json.assets || [])]) {
      const m = f.startsWith(dir + "/") && /^([^/]+)\//.exec(f.slice(dir.length + 1));
      if (m) names.add(m[1]);
    }
    this.rooms = [...names].sort().map((name) => ({ name, file: `${dir}/${name}/${name}.tscn` }));
    this.roomIndex = 0;
    return this.rooms;
  }

  // the control (menu / option / go / a list row) at (x, y)
  buttonAt(x, y) {
    const l = this.buttonsLayout();
    if (!l) return null;
    const inR = (r) => r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
    for (const r of l.list || []) if (inR(r)) return { kind: "row", index: r.index };
    for (const k of ["menu", "option", "go"]) if (inR(l[k])) return { kind: k };
    return null;
  }

  buttonFont() {
    const th = this.esc.dialogTheme && this.esc.dialogTheme.props;
    const res = th && resPath(th.default_font);
    return res ? this.game.resolveFont(res, 16) : null;
  }

  // ---------------------------------------------------------------- input

  /** Is (x, y) over the UI (the inventory panel or the menu button)? */
  overPanel(x, y) {
    if (!this.visible || !this.uiShown) return false;
    if (this.buttonAt(x, y)) return true;
    return !!this.panel && y >= this.panelY;
  }

  pointerMove(screen, room) {
    this.mouse = screen;
    if (screen && this.panel && this.uiShown && this.visible) {
      // detector_in: the title strip opens it; detector_out: above the panel closes it
      if (!this.inventoryOpen && screen.y >= this.H - TITLE_HEIGHT) this.openInventory();
      else if (this.inventoryOpen && screen.y < this.panelY) this.closeInventory();
    }
    let obj = null, inInventory = false;
    if (screen && this.overPanel(screen.x, screen.y)) {
      obj = this.inventoryItemAt(screen);
      inInventory = !!obj;
    } else if (room) obj = this.itemAt(room);
    if (obj === this.hover) return;
    const was = this.hover, wasInInventory = this.hoverInInventory;
    this.hover = obj;
    this.esc.setHovered(obj);
    this.hoverInInventory = inInventory;
    if (this.esc.inputMode !== "ALL") return;
    if (was) wasInInventory ? this.inventoryItemUnfocused() : this.elementUnfocused();
    if (obj) inInventory ? this.inventoryItemFocused(obj) : this.elementFocused(obj);
  }

  clickPanel(x, y, button = 0) {
    if (!this.overPanel(x, y)) return false;
    const hit = this.buttonAt(x, y);
    const wasOpen = this.roomListOpen;
    this.roomListOpen = false;
    if (hit) {
      if (button !== 0) return true;
      if (hit.kind === "menu") this.esc.menus?.showPause(); // _on_MenuButton_pressed
      else if (hit.kind === "option") this.roomListOpen = !wasOpen;
      else if (hit.kind === "row") this.roomIndex = hit.index;
      else if (hit.kind === "go") this.goToRoom();
      return true;
    }
    const obj = this.inventoryItemAt({ x, y });
    const esc = this.esc, am = esc.actions;
    if (!obj || esc.inputMode !== "ALL" || esc.state !== "DEFAULT") return true;
    if (button === 2) {
      // right_click_on_inventory_item
      this.elementFocused(obj);
      am.setCurrentAction("look");
      am.itemClick(obj.globalId, { position: obj.position });
      return true;
    }
    // left_click_on_inventory_item
    am.itemClick(obj.globalId, { position: obj.position }, false);
    if (am.currentAction === VERB_USE) {
      this.toolTexture = obj.node.props.inventory_texture || null;
      am.currentTool = obj;
      if (am.currentTarget) {
        this.toolTexture = null;
        this.setByName(VERB_WALK);
      }
    }
    return true;
  }

  clickRoom(p, button, doubleClick) {
    const esc = this.esc, am = esc.actions;
    if (esc.inputMode !== "ALL" || esc.state !== "DEFAULT") return;
    const obj = this.itemAt(p);
    const event = { position: p, doubleClick };
    if (!obj) {
      // left_click_on_bg; right_click_on_bg = left_double_click_on_bg (fast)
      if (esc.player) {
        am.backgroundClick(esc.player.globalId, p, doubleClick || button === 2);
        this.resetVerb();
      }
      this.closeInventory();
      return;
    }
    if (button === 2) {
      // right_click_on_item
      this.elementFocused(obj);
      this.setByName("look");
      am.itemClick(obj.globalId, event);
      return;
    }
    if (doubleClick) return void am.itemClick(obj.globalId, event); // left_double_click_on_item
    // left_click_on_item
    if (am.currentAction === "") this.setByName(obj.node.props.default_action || "");
    am.itemClick(obj.globalId, event);
    this.toolTexture = null;
    this.closeInventory();
  }

  /** The mouse wheel: mousewheel_action(). True if used. */
  wheel(dy) {
    if (!this.uiShown || this.esc.inputMode !== "ALL" || !this.cursors.length) return false;
    this.iterateActionsCursor(dy > 0 ? 1 : -1);
    return true;
  }

  // ---------------------------------------------------------------- update / draw

  update(dt) {
    super.update(dt);
    const esc = this.esc;
    if (esc.roomObject !== this.lastRoom) {
      this.lastRoom = esc.roomObject;
      this.resetVerb(); // _on_room_ready
    }
    this.syncInputMode();
    if (this.panelT < 1) {
      this.panelT = Math.min(1, this.panelT + dt / SLIDE_SECS);
      const t = 1 - Math.pow(1 - this.panelT, 3); // TRANS_CUBIC, EASE_OUT
      this.panelY = this.panelFrom + (this.panelTo - this.panelFrom) * t;
    }
  }

  draw(ctx, mouse) {
    if (this.scene && this.visible && this.uiShown) {
      this.drawPanel(ctx);
      this.drawMenuButton(ctx, mouse);
      this.drawTooltip(ctx, mouse);
      this.drawTool(ctx, mouse);
    }
    this.drawAvatarDialog(ctx);
    if (this.chooser) this.drawChooser(ctx, mouse);
  }

  drawPanel(ctx) {
    if (!this.panel) return;
    const tex = this.game.texture(this.panel.props.texture);
    if (tex) ctx.drawImage(tex.img, tex.sx, tex.sy, tex.sw, tex.sh, 0, Math.round(this.panelY), tex.sw, tex.sh);
    const f = this.buttonFont();
    if (this.label && f) {
      const p = this.label.props;
      const text = this.game.tr(p.text || "");
      const w = this.textWidth(f, text), bw = (p.offset_right || 0) - (p.offset_left || 0);
      this.drawText(ctx, f, text, (p.offset_left || 0) + (bw - w) / 2, this.panelY + (p.offset_top || 0), "#fff");
    }
    this.syncInventory();
    const box = this.itemsBox();
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    this.invOrder.forEach((id, i) => {
      const obj = this.esc.inventoryObject(id);
      const c = this.gridCell(i);
      const res = (this.hover === obj && obj.node.props.inventory_texture_hovered) || obj.node.props.inventory_texture;
      const tex = this.game.texture(res);
      if (!tex) return;
      const k = Math.min(c.w / tex.sw, c.h / tex.sh);
      ctx.drawImage(tex.img, tex.sx, tex.sy, tex.sw, tex.sh, box.x + c.x, box.y + c.y, tex.sw * k, tex.sh * k);
    });
    ctx.restore();
  }

  drawMenuButton(ctx, mouse) {
    const l = this.buttonsLayout(), f = this.buttonFont();
    if (!l) return;
    const box = (r, text, hot) => {
      ctx.fillStyle = hot ? "rgba(70,70,80,0.95)" : "rgba(40,40,48,0.95)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      this.drawText(ctx, f, text, r.x + 8, r.y + 4, hot ? "#fff" : "#ddd");
    };
    const over = (r) => mouse && mouse.x >= r.x && mouse.y >= r.y && mouse.x < r.x + r.w && mouse.y < r.y + r.h;
    const m = l.menu, text = this.game.tr(this.menuButton.props.text || "");
    ctx.fillStyle = over(m) ? "rgba(70,70,80,0.9)" : "rgba(40,40,48,0.9)";
    ctx.fillRect(m.x, m.y, m.w, m.h);
    this.drawText(ctx, f, text, m.x + (m.w - this.textWidth(f, text)) / 2, m.y + 4, over(m) ? "#fff" : "#ddd");
    if (!l.option) return;
    box(l.option, this.rooms[this.roomIndex].name + "  \u02c5", over(l.option));
    box(l.go, "Go", over(l.go));
    if (l.list && l.list.length) {
      const a = l.list[0], b = l.list[l.list.length - 1];
      ctx.fillStyle = "rgba(33, 33, 38, 0.97)";
      ctx.fillRect(a.x - 2, a.y - 4, a.w + 4, b.y + b.h - a.y + 8);
      for (const r of l.list) {
        const sel = r.index === this.roomIndex, hot = over(r);
        if (hot) {
          ctx.fillStyle = "rgba(90, 90, 100, 0.9)";
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
        // radio mark: ring for the selected one, a dim dot for the rest
        const cx = r.x + 10, cy = r.y + r.h / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
        if (sel) {
          ctx.strokeStyle = "#ddd";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.lineWidth = 1;
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.15)";
          ctx.fill();
        }
        this.drawText(ctx, f, this.rooms[r.index].name, r.x + 22, r.y + 4, hot || sel ? "#fff" : "#ccc");
      }
    }
  }

  // room_select.gd _on_button_pressed()
  goToRoom() {
    const r = this.rooms[this.roomIndex];
    if (!r) return;
    // (in Godot too: a folder without <name>.tscn, like intro, can't be loaded)
    if (!this.game.files[r.file]) return this.esc.log(`room_select: ${r.file} doesn't exist`, "error");
    this.esc.globals.set("FORCE_LAST_SCENE_NULL", true, true);
    this.esc.events.interrupt();
    this.esc.changeScene(r.file);
  }

  // tooltip_target.gd + game.gd update_tooltip_following_mouse_position()
  drawTooltip(ctx, mouse) {
    const n = this.tooltip;
    if (!n || !mouse || !this.tooltipTarget) return;
    const f = this.fontOf(n, "theme_override_fonts/normal_font", "theme_override_font_sizes/normal_font_size");
    if (!f) return;
    const text = this.game.tr(this.tooltipTarget);
    const w = this.textWidth(f, text), h = this.textHeight(f);
    const margin = this.scene.props.mouse_tooltip_margin ?? 50;
    let x = mouse.x + 32, y = mouse.y - h / 2;
    if (mouse.y <= margin) y = margin;
    if (this.H - (mouse.y + h) <= margin) y = this.H - margin - h;
    if (mouse.x - w / 2 <= margin) x = margin;
    if (this.W - (mouse.x + w / 2) <= margin) x = this.W - margin - w;
    this.drawText(ctx, f, text, x, y, n.props.color ? cssColor(n.props.color) : "#fff");
  }

  drawTool(ctx, mouse) {
    if (!this.toolTexture || !mouse) return;
    const tex = this.game.texture(this.toolTexture);
    if (tex) ctx.drawImage(tex.img, tex.sx, tex.sy, tex.sw, tex.sh, mouse.x + 48, mouse.y - 16, tex.sw, tex.sh);
  }
}
