// The game's own main / pause menus: the nodes the game scene names in
// game.gd's main_menu / pause_menu (9-verbs), when their scripts are
// translated (esc.nodeScripts). Like game.gd: show_main_menu() / pause_game()
// reset() and show them (with set_save_enabled), unpause_game() hides the
// pause menu. They are scene Controls: drawn by the renderer and used through
// the Controls input (esc.controls, modal while a menu is open).
//
// Same interface as Menus (ui/menus.js), which is used when the game doesn't
// bring menus with scripts: open, showMain, showPause, close, draw,
// pointerDown / pointerMove / pointerUp, wheel, key, settings.
import { collect, draw } from "../../godot/render.js";
import { drawPopup } from "../../godot/controls.js";
import { DEFAULT_SETTINGS } from "./menus.js";

const nodePath = (v) => (v && v.args ? v.args[0] : typeof v === "string" ? v : null);

export class SceneMenus {
  /** The game's menus if its game scene has them with translated scripts, else null. */
  static create(esc, gameScene) {
    if (!gameScene) return null;
    const at = (key) => {
      const p = nodePath(gameScene.props[key]);
      return p ? gameScene.getNode(p) : null;
    };
    const main = at("main_menu"), pause = at("pause_menu");
    const scripted = (n) => n && n.script && esc.nodeScripts[n.script];
    if (!scripted(main) && !scripted(pause)) return null;
    return new SceneMenus(esc, main, pause);
  }

  constructor(esc, main, pause) {
    this.esc = esc;
    this.main = main;
    this.pause = pause;
    this.settings = { ...DEFAULT_SETTINGS, ...(esc.storageGet("settings") || {}) };
    // while a menu is open, the Controls input only sees it
    esc.menuRoot = null;
    esc.hooks.menus = this;
  }

  // the script instance of a menu node (the bridge's wrapper)
  script(n) {
    return n && this.esc.hooks.scriptOf ? this.esc.hooks.scriptOf(n) : null;
  }
  visible(n) {
    return !!n && n.props.visible !== false;
  }
  setVisible(n, v) {
    const s = this.script(n);
    if (s) v ? s.show() : s.hide(); // the script hears visibility_changed
    else n.props.visible = v;
  }
  get open() {
    return this.visible(this.main) || this.visible(this.pause);
  }
  /** game.gd pause_game() pauses the tree; show_main_menu() doesn't. */
  get paused() {
    return this.visible(this.pause);
  }
  get current() {
    return this.visible(this.pause) ? this.pause : this.visible(this.main) ? this.main : null;
  }
  sync() {
    this.esc.menuRoot = this.current;
  }

  /** game.gd show_main_menu() */
  showMain() {
    if (!this.main || this.visible(this.main)) return;
    this.esc.ui.setGuiVisible?.(false);
    this.script(this.main)?.reset?.();
    this.setVisible(this.main, true);
    this.sync();
  }
  hideMain() {
    if (!this.visible(this.main)) return;
    this.setVisible(this.main, false);
    this.esc.ui.setGuiVisible?.(true);
    this.esc.hooks.menusClosed?.();
    this.sync();
  }
  /** game.gd pause_game() */
  showPause() {
    if (!this.pause || this.visible(this.pause)) return;
    const s = this.script(this.pause);
    s?.reset?.();
    s?.set_save_enabled?.(!!this.esc.saveEnabled);
    this.setVisible(this.pause, true);
    this.esc.sounds?._speech?.pause?.();
    this.esc.ui.setGuiVisible?.(false);
    this.sync();
  }
  /** game.gd unpause_game() */
  close() {
    if (this.visible(this.pause)) {
      this.setVisible(this.pause, false);
      this.esc.sounds?._speech?.resume?.();
      this.esc.ui.setGuiVisible?.(true);
      this.esc.hooks.menusClosed?.();
    } else this.hideMain();
    this.sync();
  }

  draw(ctx) {
    const n = this.current;
    if (!n) return;
    draw(ctx, this.esc.game, collect(n));
    drawPopup(ctx);
  }

  // input: the open menu's Controls
  pointerDown(s, button = 0) {
    this.sync();
    this.esc.controls.down(s, button);
    this.sync();
  }
  pointerMove(s) {
    this.esc.controls.move(s);
  }
  pointerUp(s, button = 0) {
    if (s) this.esc.controls.up(s, button);
    this.sync();
  }
  wheel(dy, s) {
    if (s) this.esc.controls.wheel(s, dy);
  }
  /** Esc closes the pause menu (ui_cancel); other keys go to the focused control. */
  key(e) {
    if (this.esc.controls.key(e)) return true;
    if (e.key === "Escape" && this.visible(this.pause)) {
      this.close();
      return true;
    }
    return false;
  }
}
