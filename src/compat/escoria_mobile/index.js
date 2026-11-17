// The JS side of the Escoria Mobile addon (github.com/joaquin-becerra/escoria-mobile-addon):
// a game that has the addon gets the same touch support in GEJE, with the same
// Project Settings (escoria/mobile/*, kept in game.json). Games without it
// play with the mouse as always.
//
// The addon's GDScript isn't translated: it relies on Godot pieces the engine
// doesn't emulate (synthetic input events, the window's content scale,
// physics picking), so this module does the same work on the player's side.
//
//   gestures.js   touch gestures -> clicks (mobile_input.gd)
//   layout.js     the room fills the screen, the panel becomes a drawer (layout.gd)
//   hud.js        the settings and highlight buttons (hud.gd)
//   web.js        fullscreen + landscape on the first touch, "turn your phone" hint
import { installGestures } from "./gestures.js";
import { installLayout } from "./layout.js";
import { installHud } from "./hud.js";
import { installWeb } from "./web.js";

const AUTOLOAD = "autoload/EscoriaMobile";

/** Does the game have the addon (its autoload, or the plugin enabled)? */
export function hasMobileAddon(game) {
  if (String(game.setting(AUTOLOAD, "")).includes("escoria-mobile")) return true;
  const plugins = game.setting("editor_plugins/enabled", null);
  const list = plugins && plugins.args ? plugins.args : Array.isArray(plugins) ? plugins : [];
  return list.some((p) => String(p).includes("/escoria-mobile/"));
}

// a Color setting ({type: "Color", args: [r, g, b, a]}) as CSS
const css = (v, def, alpha = null) => {
  const a = v && v.args ? v.args : def;
  return `rgba(${Math.round(a[0] * 255)},${Math.round(a[1] * 255)},${Math.round(a[2] * 255)},${alpha ?? a[3] ?? 1})`;
};
const vec2 = (v, def) => (v && v.args ? { w: v.args[0], h: v.args[1] } : def);

/** The addon's settings, with its defaults (settings.gd). */
export function mobileSettings(game) {
  const get = (key, def) => game.setting(`escoria/mobile/${key}`, def);
  return {
    enabled: Number(get("enabled", 0)), // 0 auto (on with the first touch), 1 always, 2 never
    doubleTapMs: Number(get("double_tap_ms", 300)),
    longPressMs: Number(get("long_press_ms", 500)),
    tapSlopMm: Number(get("tap_slop_mm", 3.0)),
    minTargetMm: Number(get("min_target_mm", 9.0)),
    twoTapAction: !!get("two_tap_action", true),
    log: !!get("debug/log", false),
    roomHeight: Number(get("layout/room_height", 0)),
    bottomPanel: String(get("layout/bottom_panel", "")),
    tabRight: Number(get("layout/tab_side", 0)) === 0,
    tabSize: vec2(get("layout/tab_size", null), { w: 88, h: 44 }),
    web: {
      fullscreen: !!get("web/fullscreen_on_first_touch", true),
      landscape: !!get("web/landscape", true),
    },
    hud: {
      on: !!get("hud", true),
      hintNames: !!get("hud_hint_names", true),
      corner: Number(get("hud_buttons/corner", 0)), // top left, top right, bottom left, bottom right
      size: Number(get("hud_buttons/size", 64)),
      margin: Number(get("hud_buttons/margin", 12)),
      settingsIcon: String(get("hud_buttons/settings_icon", "")),
      highlightIcon: String(get("hud_buttons/highlight_icon", "")),
      highlightSeconds: Number(get("hud_buttons/highlight_seconds", 3)),
    },
    marks: {
      fill: css(get("style/mark_fill", null), [0.094, 0.243, 0.408, 0.35]),
      ring: css(get("style/mark_ring", null), [0.094, 0.243, 0.408, 0.9]),
      radius: Number(get("style/mark_radius", 18)),
    },
    style: {
      background: css(get("style/background", null), [0.094, 0.243, 0.408, 0.85]),
      backgroundOpaque: css(get("style/background", null), [0.094, 0.243, 0.408, 0.85], 1),
      foreground: css(get("style/foreground", null), [0.886, 0.875, 0.863, 1]),
      accent: css(get("style/accent", null), [1, 0.85, 0.2, 1]),
      borderWidth: Number(get("style/border_width", 2)),
      backdrop: css(get("style/backdrop", null), [0, 0, 0, 0.7]),
      backdropColor: (get("style/backdrop", null) || {}).args || [0, 0, 0, 0.7],
    },
  };
}

/**
 * Installs the addon's JS side if the game has the addon. Returns null if not.
 * @param {object} o  {game, canvas, pointer, host} (see gestures.js for
 *   `pointer`, layout.js for `host`)
 */
export function installMobile({ game, canvas, pointer, host }) {
  if (!hasMobileAddon(game)) return null;
  const settings = mobileSettings(game);
  if (settings.enabled === 2) return null;
  const log = settings.log ? (m) => console.log(`EscoriaMobile: ${m}`) : () => {};
  const touch = { active: settings.enabled === 1 };
  const layout = settings.roomHeight > 0 && host ? installLayout({ host, settings, touch, log }) : null;
  const hud = settings.hud.on && host ? installHud({ host, game, settings, layout, touch }) : null;
  const web = host ? installWeb({ canvas, host, settings, log }) : null; // last: its hint covers everything

  // "object, then verb": a 1st tap on an item opens the drawer; a verb chosen
  // there acts on that item at once
  let verbItem = null; // where the item was tapped
  const verbAt = (s) => {
    const ui = host && host.gameUI;
    if (!ui || !ui.verbs || !ui.overPanel?.(s.x, s.y)) return null;
    return ui.verbs().find((v) => {
      const r = ui.rect(v);
      return ui.visibleNode(v) && s.x >= r.x && s.y >= r.y && s.x < r.x + r.w && s.y < r.y + r.h;
    }) || null;
  };
  const p = {
    ...pointer,
    isGui: (s) => !!(web && web.blocking()) || !!(layout && layout.inTab(s)) || !!(hud && hud.covers(s)) || pointer.isGui(s),
    armed(item, s) {
      if (!layout) return;
      verbItem = s;
      layout.open();
    },
    click(s, button = 0, double = false) {
      if (web && web.blocking()) return; // "turn your phone"
      if (button === 0 && ((hud && hud.tap(s)) || (layout && layout.tapTab(s)))) return;
      const gui = pointer.isGui(s);
      const verb = layout && verbItem && layout.isOpen ? verbAt(s) : null;
      pointer.click(s, button, double);
      if (!layout) return;
      if (!gui) {
        // an action or a walk in the room
        verbItem = null;
        layout.close();
      } else if (verb) {
        const at = verbItem;
        verbItem = null;
        layout.close(false);
        pointer.hover(at);
        pointer.click(at, 0);
        log(`verb ${verb.name} on the tapped item`);
      }
    },
  };
  const gestures = installGestures({ canvas, settings, pointer: p, log, state: touch });
  return { settings, gestures, layout, hud, web };
}
