// A game scene with its own script (escoria/ui/game_scene whose root script
// extends ESCGame and is translated, e.g. Superfluous Returnz's Sosage UI):
// the scene goes under /root (esc.screenRoot) like Godot's main scene, so the
// renderer draws it, its Controls take the mouse and its scripts get
// _process / _input. The engine plays Escoria's inputs manager
// (esc_inputs_manager.gd): the item under the mouse and the clicks on the
// room become the script's element_focused / element_unfocused,
// left_click_on_item, left_click_on_bg... The inventory is the scene's
// ESCInventory (its buttons call the script, see the bridge's adapters).
//
// Speech and the dialog chooser stay GameUI's (through esc.hooks.ui, the
// dialog scenes' translated scripts).
import { GameUI, resPath } from "./game_ui.js";
import { instantiate } from "../../godot/scene.js";

/** Does the game scene's root have a translated script (a game's own ESCGame)? */
export function isScripted(esc) {
  const file = esc.game.setting("escoria/ui/game_scene", "");
  const root = esc.game.files[file] && esc.game.files[file].nodes && esc.game.files[file].nodes[0];
  const script = root && root.props && root.props.script && root.props.script.$res;
  return !!script && !!esc.nodeScripts[script];
}

export class ScriptedGameUI extends GameUI {
  static async create(esc, width, height) {
    const ui = new ScriptedGameUI(esc, width, height);
    await ui.load();
    return ui;
  }

  async load() {
    const file = this.game.setting("escoria/ui/game_scene", "");
    this.scene = instantiate(this.game, file);
    for (const n of this.scene.walk()) {
      await this.game.loadImagesIn(n.props);
      for (const k of ["theme_override_fonts/font", "theme_override_fonts/normal_font"]) {
        const f = resPath(n.props[k]);
        if (f) await this.game.loadFont(f).catch(() => null);
      }
      const th = n.props.theme && n.props.theme.$res ? this.game.resource(n.props.theme.$res) : n.props.theme;
      const df = th && th.props && resPath(th.props.default_font);
      if (df) await this.game.loadFont(df).catch(() => null);
    }
    // the dialog player's theme: the dialog scenes take it
    const dp = this.scene.find((n) => n.scriptName === "esc_dialog_player");
    this.esc.dialogTheme = (dp && dp.props.theme) || null;
    this.uiRoot = null; // nothing for GameUI to draw: the renderer draws the scene
    this.invGrid = null;
    this.hover = null;
    this.shown = true;
    // under /root: drawn with the spawned scenes, its Controls get the mouse
    this.esc.screenRoot.add(this.scene);
    this.esc.hooks.gameScript = () => this.script;
    this.handles = this.esc.attachScripts(this.scene);
    this.script = this.esc.hooks.scriptOf ? this.esc.hooks.scriptOf(this.scene) : null;
    // ESCGame: event_manager.event_finished -> _on_event_done(return_code, event_name)
    this.esc.events.listeners.push((rc, name) => this.call("_on_event_done", rc ?? 0, name ?? ""));
    this.esc.hooks.menusClosed = () => this.call("show_ui");
    // escoria.gd _reset_new_game_runtime_state() (new game, load): the menus close
    this.esc.hooks.gameReset = () => {
      this.call("close_inventory");
      this.esc.menus?.hideMain?.();
      this.esc.menus?.close?.();
    };
  }

  /** A method of the game's script, if it has it. */
  call(method, ...args) {
    const s = this.script;
    if (!s || typeof s[method] !== "function") return undefined;
    try {
      return s[method](...args);
    } catch (e) {
      this.esc.log(`${method}(): ${e.message}`, "error");
      console.error(e);
    }
  }

  // setGuiVisible(): the script's show_ui() / hide_ui()
  get visible() {
    return this.shown ?? true;
  }
  set visible(v) {
    if (v === this.shown) return;
    this.shown = v;
    if (this.script) this.call(v ? "show_ui" : "hide_ui");
  }

  get cursor() {
    return "";
  }
  updateSentence() {}
  setTarget() {}
  setTarget2() {}
  clearTooltip() {}
  overPanel() {
    return false;
  }
  clickPanel() {
    return false;
  }

  // ---------------------------------------------------------------- esc_inputs_manager.gd

  /** The mouse moved: the item under it is focused (element_focused / element_unfocused). */
  pointerMove(screen, room) {
    const obj = room ? this.itemAt(room) : null;
    if (obj === this.hover) return;
    const was = this.hover;
    this.hover = obj;
    this.esc.setHovered(obj);
    if (was) this.call("element_unfocused");
    if (obj) this.call("element_focused", obj.globalId);
  }

  /** A click in the room (p in room coordinates; button 0 left, 2 right). */
  clickRoom(p, button, doubleClick) {
    if (this.esc.inputMode !== "ALL") return;
    const hooks = this.esc.hooks;
    const obj = this.itemAt(p);
    const pos = hooks.vector2 ? hooks.vector2(p.x, p.y) : p;
    const ev = hooks.mouseButtonEvent ? hooks.mouseButtonEvent(p, button, doubleClick) : { position: pos, double_click: doubleClick };
    if (!obj) {
      if (button === 2) this.call("right_click_on_bg", pos);
      else if (doubleClick) this.call("left_double_click_on_bg", pos);
      else this.call("left_click_on_bg", pos);
      return;
    }
    if (button === 2) this.call("right_click_on_item", obj.globalId, ev);
    else if (doubleClick) this.call("left_double_click_on_item", obj.globalId, ev);
    else this.call("left_click_on_item", obj.globalId, ev);
  }

  wheel(dy) {
    if (this.esc.inputMode !== "ALL") return false;
    this.call("mousewheel_action", dy < 0 ? -1 : 1);
    return false;
  }

  // GameUI draws only the native chooser / avatar speech (the game's scripts draw the rest)
  draw(ctx, mouse) {
    this.drawAvatarDialog(ctx);
    if (this.chooser) this.drawChooser(ctx, mouse);
  }
}
