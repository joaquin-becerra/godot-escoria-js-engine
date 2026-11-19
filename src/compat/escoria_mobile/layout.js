// Phone layout of the Escoria Mobile addon (layout.gd), for GEJE: the room
// fills the screen instead of letterboxing the whole design (room + panel).
//
// The design is e.g. 1280x800: a 1280x576 room on top and a 224 px panel
// (verbs, inventory) below. Once touch is active, the game's view takes the
// room as its base size with the "expand" aspect, so it gets the screen's
// shape. Then, by the space left under the room:
//
//   DOCKED  the whole panel fits under the room (tablets): stays as designed.
//   DRAWER  it doesn't (phones): the panel becomes a drawer. Closed, it sits
//           under the room (partly visible on 16:9, hidden on 20:9); open, it
//           slides up over the bottom of the room. It opens on the first tap
//           on an item or with the tab, and closes after an action or a walk.
//   FULL    a menu is open: the original letterboxed design comes back.
//
// In DRAWER mode, a game's dialog chooser scene (its options drawn where the
// panel is) slides up over the bottom of the room too, on a translucent
// backdrop (style/backdrop), and goes back when it's gone.
//
// Settings: escoria/mobile/layout/room_height (0 = off) and
// layout/bottom_panel (the panel's node path in the game scene).
import { Node } from "../../godot/scene.js";

export const Mode = { NONE: "NONE", FULL: "FULL", DOCKED: "DOCKED", DRAWER: "DRAWER" };
const SLIDE_TIME = 0.18;

/**
 * @param {object} o
 * @param {object} o.host      the player's side (player.js mobileHost)
 * @param {object} o.settings  index.js mobileSettings()
 * @param {{active: boolean}} o.touch  gestures' state: on once touch is used
 * @param {(msg: string) => void} o.log
 */
export function installLayout({ host, settings, touch, log }) {
  const roomH = settings.roomHeight;
  const design = { w: host.view.w, h: host.view.h }; // the project's viewport
  let mode = Mode.NONE;
  let isOpen = false;
  let panel = null, home = null; // the panel node and its designed offsets
  let slide = null; // {from, to, t}
  let camSaved = null; // {limits, bottom}: the camera limit we lowered
  let shifted = null; // {node, top, bottom, backdrop}: the chooser we slid up

  const findPanel = () => {
    const scene = host.gameUI && host.gameUI.scene;
    const n = scene && settings.bottomPanel ? scene.getNode(settings.bottomPanel) : null;
    if (n && n !== panel) {
      panel = n;
      home = { top: n.props.offset_top ?? 0, bottom: n.props.offset_bottom ?? 0 };
      log(`panel ${settings.bottomPanel}: ${home.bottom - home.top} px`);
    }
    return panel;
  };
  const panelH = () => (home ? home.bottom - home.top : 0);
  const panelY = () => (panel ? panel.props.offset_top ?? 0 : 0);
  const setPanelY = (y) => {
    if (!panel) return;
    panel.props.offset_top = y;
    panel.props.offset_bottom = y + panelH();
  };
  const panelShown = () => {
    const ui = host.gameUI;
    if (!panel || !ui || !ui.visible || !host.esc || !host.esc.view) return false;
    for (let n = panel; n; n = n.parent) if (n.props.visible === false) return false;
    return true;
  };

  // the view with the room as base size and the "expand" aspect
  const roomView = () => {
    const a = window.innerWidth / Math.max(1, window.innerHeight);
    return a >= design.w / roomH ? { w: Math.round(roomH * a), h: roomH } : { w: design.w, h: Math.round(design.w / a) };
  };

  function wanted() {
    if (!roomH || !touch.active || !findPanel()) return Mode.NONE;
    if (host.menus && host.menus.open) return Mode.FULL;
    return roomView().h - roomH >= panelH() ? Mode.DOCKED : Mode.DRAWER;
  }

  function apply() {
    if (mode === Mode.DOCKED || mode === Mode.DRAWER) {
      const v = roomView();
      if (v.w !== host.view.w || v.h !== host.view.h) host.setView(v.w, v.h);
    } else if (host.view.w !== design.w || host.view.h !== design.h) host.setView(design.w, design.h);
    if (mode !== Mode.DRAWER) {
      slide = null;
      if (home) setPanelY(home.top);
    } else if (!slide) setPanelY(target());
  }

  const target = () => (isOpen ? host.view.h - panelH() : Math.max(home ? home.top : roomH, 0));

  function slideTo(y, animate) {
    if (!animate) {
      slide = null;
      setPanelY(y);
    } else slide = { from: panelY(), to: y, t: 0 };
  }

  // Escoria may stretch the camera limits to the whole design height; while
  // the room fills the screen, the bottom limit is the room's
  function fixCamera(filling) {
    const cam = host.esc && host.esc.cameraPlayer;
    if (!cam) return;
    if (camSaved && camSaved.limits !== cam.limits) camSaved = null; // a new room
    if (filling) {
      if (cam.limits.bottom > roomH && cam.limits.top <= 0) {
        camSaved ||= { limits: cam.limits, bottom: cam.limits.bottom };
        cam.limits.bottom = roomH;
      }
    } else if (camSaved) {
      camSaved.limits.bottom = camSaved.bottom;
      camSaved = null;
    }
  }

  host.onFrame((dt) => {
    const want = wanted();
    if (want !== mode) {
      mode = want;
      isOpen = false;
      log(`layout: ${mode}`);
    }
    apply();
    fixCamera(mode === Mode.DOCKED || mode === Mode.DRAWER);
    updateChooser();
    if (slide) {
      slide.t = Math.min(1, slide.t + dt / SLIDE_TIME);
      const k = 1 - (1 - slide.t) * (1 - slide.t); // ease out
      setPanelY(slide.from + (slide.to - slide.from) * k);
      if (slide.t >= 1) slide = null;
    }
  });
  window.addEventListener("resize", () => apply());

  // ---------------------------------------------------------------- dialog chooser

  // the game's chooser scene on screen (a Control under /root), if any
  function chooserNode() {
    const ui = host.gameUI, esc = host.esc;
    if (!ui || !ui.chooser || !ui.chooser.external || !esc || !esc.screenRoot) return null;
    const kids = esc.screenRoot.children.filter((c) => c.type !== "CanvasLayer" && c.props.visible !== false);
    return kids.find((c) => /chooser/i.test(c.sceneFile || "")) || kids[kids.length - 1] || null;
  }

  function unshift() {
    if (!shifted) return;
    const { node, top, bottom, backdrop } = shifted;
    node.props.offset_top = top;
    node.props.offset_bottom = bottom;
    node.remove(backdrop);
    shifted = null;
  }

  function updateChooser() {
    const node = mode === Mode.DRAWER ? chooserNode() : null;
    if (shifted && shifted.node !== node) unshift();
    if (!node) return;
    if (!shifted) {
      // designed for the bottom of the full design: the same distance from the view's bottom
      const backdrop = new Node("mobile_backdrop", "ColorRect");
      backdrop.parent = node;
      node.children.unshift(backdrop); // under the options
      shifted = { node, top: node.props.offset_top ?? 0, bottom: node.props.offset_bottom ?? 0, backdrop };
      log("dialog chooser slid up");
    }
    const dy = host.view.h - design.h;
    node.props.offset_top = shifted.top + dy;
    node.props.offset_bottom = shifted.bottom + dy;
    Object.assign(shifted.backdrop.props, {
      offset_left: 0, offset_top: roomH, offset_right: Math.max(host.view.w, design.w), offset_bottom: design.h,
      color: { type: "Color", args: settings.style.backdropColor }, mouse_filter: 2,
    });
  }

  // ---------------------------------------------------------------- tab

  const tab = () => {
    const s = settings.tabSize;
    const top = Math.min(panelY(), host.view.h);
    const x = settings.tabRight ? host.view.w - s.w - 12 : 12;
    return { x, y: top - s.h, w: s.w, h: s.h };
  };
  const tabShown = () => mode === Mode.DRAWER && panelShown();

  host.onDraw((ctx) => {
    if (!tabShown()) return;
    const r = tab(), st = settings.style;
    const slant = Math.min(8, r.w / 4);
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.beginPath();
    ctx.moveTo(slant, 0);
    ctx.lineTo(r.w - slant, 0);
    ctx.lineTo(r.w, r.h);
    ctx.lineTo(0, r.h);
    ctx.closePath();
    ctx.fillStyle = st.background;
    ctx.fill();
    if (st.borderWidth > 0) {
      ctx.lineWidth = st.borderWidth;
      ctx.strokeStyle = st.foreground;
      ctx.stroke();
    }
    // up to open, down to close
    const u = r.h / 44, cx = r.w / 2, cy = r.h / 2 + 2 * u, d = isOpen ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(cx - 14 * u, cy - d * 7 * u);
    ctx.lineTo(cx, cy + d * 7 * u);
    ctx.lineTo(cx + 14 * u, cy - d * 7 * u);
    ctx.lineWidth = 5 * u;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.strokeStyle = st.foreground;
    ctx.stroke();
    ctx.restore();
  });

  const inTab = (s) => {
    if (!tabShown()) return false;
    const r = tab();
    return s.x >= r.x && s.y >= r.y && s.x < r.x + r.w && s.y < r.y + r.h;
  };

  // ---------------------------------------------------------------- API

  const api = {
    get mode() { return mode; },
    get isOpen() { return isOpen; },
    /** Opens the drawer (DRAWER mode only). */
    open() {
      if (mode !== Mode.DRAWER || isOpen) return;
      isOpen = true;
      slideTo(target(), true);
    },
    /** Closes it; at once if !animate (right before clicking the room under it). */
    close(animate = true) {
      if (mode !== Mode.DRAWER || !isOpen) return;
      isOpen = false;
      slideTo(target(), animate);
    },
    /** A tap on the tab: opens / closes the drawer. True if it was on the tab. */
    tapTab(s) {
      if (!inTab(s)) return false;
      if (isOpen) api.close();
      else api.open();
      return true;
    },
    inTab,
    panelShown,
    /** Top of the panel on screen (the view's bottom if it's lower). */
    panelTop: () => Math.min(panelY(), host.view.h),
    tabShown,
    tabOnRight: () => settings.tabRight,
  };
  return api;
}
