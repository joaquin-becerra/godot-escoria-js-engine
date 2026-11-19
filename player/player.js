// Plays an exported game: new game from the start script's :init, the game's
// UI, Esc for the pause menu. No debug tools (see viewer/ for those).
//   player/?game=openquest-escoria
//   player/?game=openquest-escoria&room=res://rooms/x/x.tscn   (testing: straight to a room,
//                                       &set=global=1,other=0 to set globals first)
import { GameData } from "../src/godot/game_data.js";
import { collect, draw } from "../src/godot/render.js";
import { drawPopup } from "../src/godot/controls.js";
import { cssColor } from "../src/godot/values.js";
import { Escoria } from "../src/escoria/escoria.js";
import { loadPorts } from "../src/escoria/ports.js";
import { createGameUI } from "../src/escoria/ui/simplemouse_ui.js";
import { Menus } from "../src/escoria/ui/menus.js";
import { SceneMenus } from "../src/escoria/ui/scene_menus.js";
import { installProbe } from "./probe.js";
import { installMobile } from "../src/compat/escoria_mobile/index.js";

// main.tscn layers/curtain: CanvasLayer 20
const TRANSITION_LAYER = 20;
let screenItems = [];

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");

// The game's own size (the project's viewport, e.g. 1280x800): everything is
// drawn and every position is in these units. The canvas itself has the
// screen's real pixels (its CSS size x devicePixelRatio), like Godot's
// "canvas_items" stretch: each sprite is scaled once, straight to the screen,
// instead of drawn at the game size and then stretched by the browser (blurry
// and jagged). ctx.setTransform/getTransform work in game units (the scale to
// the screen is added/removed); ctx.__device has the real ones.
const view = { w: 1, h: 1, sx: 1, sy: 1 };
canvas.gameSize = view; // for the test tools (geje_test.js, probe.js, autopilot.js)
{
  const setT = ctx.setTransform.bind(ctx), getT = ctx.getTransform.bind(ctx);
  ctx.__device = { setTransform: setT, getTransform: getT };
  ctx.setTransform = function (a, b, c, d, e, f) {
    if (typeof a === "object") ({ a = 1, b = 0, c = 0, d = 1, e = 0, f = 0 } = a);
    setT(a * view.sx, b * view.sy, c * view.sx, d * view.sy, e * view.sx, f * view.sy);
  };
  ctx.resetTransform = () => ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.getTransform = function () {
    const m = getT();
    return new DOMMatrix([m.a / view.sx, m.b / view.sy, m.c / view.sx, m.d / view.sy, m.e / view.sx, m.f / view.sy]);
  };
}

// The canvas fills the window keeping the game's shape (letterbox), with one
// canvas pixel per screen pixel.
function fitCanvas() {
  const aspect = view.w / view.h;
  let cw = window.innerWidth, ch = window.innerHeight;
  if (cw / ch > aspect) cw = ch * aspect;
  else ch = cw / aspect;
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.max(1, Math.round(cw * dpr)), ph = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw; // also resets the context's state; each frame sets what it needs
    canvas.height = ph;
  }
  view.sx = pw / view.w;
  view.sy = ph / view.h;
}
window.addEventListener("resize", fitCanvas);
document.addEventListener("fullscreenchange", fitCanvas);
// the page moved to a screen with another pixel ratio (or the browser zoom changed)
(function watchRatio() {
  matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener("change", () => {
    fitCanvas();
    watchRatio();
  }, { once: true });
})();
const params = new URLSearchParams(location.search);
let game, esc, gameUI, menus;
let mouse = null;
let clickWaiters = [];
let ended = false; // escoria.quit(): the game is over

const ui = {
  say: (obj, text, { cmd, key, type } = {}) => gameUI.say(obj, text, cmd, key, type),
  chooseDialogOption: (dialog) => gameUI.chooseDialogOption(dialog),
  setGuiVisible(v) {
    if (gameUI) gameUI.visible = v;
  },
  waitClick: () => new Promise((ok) => clickWaiters.push(ok)),
  roomChanged() {},
  captureScreen(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(canvas, 0, 0, w * view.sx, h * view.sy, 0, 0, w, h); // w x h game units
    return c;
  },
  gameLoading() {
    if (!gameUI) return; // before the UI exists (a game script at startup)
    gameUI.endSpeech();
    if (gameUI.chooser) gameUI.choose(null);
    gameUI.clearTooltip();
  },
  // the language changed in the options: the sentence line is built again
  languageChanged() {
    gameUI?.updateSentence(); // the game's scripts can change it before the UI exists (first_run_locale.gd)
  },
  quit() {
    ended = true;
  },
  applySettings(s) {
    esc.applyVolumes();
    if (s.fullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (!s.fullscreen && document.fullscreenElement) document.exitFullscreen?.();
  },
};

function log(msg, level) {
  if (level === "error") console.warn(msg);
}

// the room camera (src/escoria/camera.js): room -> screen this frame
function roomTransform() {
  const m = esc.cameraPlayer.transform();
  return [m[0], 0, 0, m[3], Math.round(m[4]), Math.round(m[5])];
}

async function start() {
  const exports = await fetch("../geje-builds/exports.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const name = params.get("game") || (exports.includes("openquest-escoria") ? "openquest-escoria" : exports[0]);
  game = await GameData.load(`../geje-builds/${name}/`);
  document.title = game.json.name || name;
  view.w = game.setting("display/window/size/viewport_width", 1152);
  view.h = game.setting("display/window/size/viewport_height", 648);
  fitCanvas();
  if (game.setting("rendering/textures/canvas_textures/default_texture_filter", 1) !== 0) canvas.style.imageRendering = "auto";
  esc = new Escoria(game, { log, ui });
  clearColor = cssColor(game.setting("rendering/environment/defaults/default_clear_color", { type: "Color", args: [0.3, 0.3, 0.3, 1] }));
  await loadPorts(esc); // the game's own scripts in JS (geje-builds/<game>/js_ports/, made by tools/export.js), if any
  gameUI = await createGameUI(esc, view.w, view.h);
  // the game's own menu scenes (translated scripts), else its ports' menus, else the engine's
  menus = SceneMenus.create(esc, gameUI.scene) || (await Menus.create(esc, gameUI.scene, view.w, view.h));
  esc.menus = menus;
  esc.settings = menus.settings;
  // the language: the one the player chose in Options (saved), else the browser's
  // if the game has it (es-AR -> es), else the project's (escoria/main/text_lang)
  const locales = game.locales();
  const browserLang = () => {
    for (const l of navigator.languages || [navigator.language]) {
      if (!l) continue;
      const exact = locales.find((x) => x.toLowerCase() === l.toLowerCase().replace("-", "_"));
      const short = locales.find((x) => x.split(/[_-]/)[0].toLowerCase() === l.split("-")[0].toLowerCase());
      if (exact || short) return exact || short;
    }
    return null;
  };
  const lang = menus.settings.lang && locales.includes(menus.settings.lang) ? menus.settings.lang : browserLang();
  if (lang) game.locale = lang;
  loadingShown(false);
  requestAnimationFrame(frame);
  // ?room=res://...tscn (a shortcut for testing): the start script's state
  // commands (globals, names...), then that room, instead of :init
  const room = params.get("room");
  if (room && game.files[room]) {
    await esc.runStateOf(game.setting("escoria/main/game_start_script", ""), "init");
    // &set=a=1,b=text: globals for the test
    for (const kv of (params.get("set") || "").split(",").filter(Boolean)) {
      const [k, v] = kv.split("=");
      esc.globals.set(k, v !== undefined && v !== "" && !isNaN(+v) ? +v : v ?? true, true);
    }
    esc.changeScene(room);
  } else esc.runStartEvent("init");
  // the Escoria Mobile addon's JS side, if the game has the addon: touch gestures
  installMobile({ game, canvas, pointer: touchPointer, host: mobileHost });
  // window.__probe for tools/compare (an outside driver with the real mouse)
  installProbe({ esc, gameUI, canvas, cam: () => ({ x: -esc.camera[4] / esc.camera[0], y: -esc.camera[5] / esc.camera[3] }), ended: () => ended, waitingClick: () => clickWaiters.length > 0 });
  // the walkthrough test from the console: geje.run(); &debug=1: its panel (player/geje_test.js)
  const { installGejeTest } = await import("./geje_test.js");
  installGejeTest({ esc, gameUI, canvas, game, gameName: name, input: driverInput, debug: params.has("debug") && params.get("debug") !== "0" });
  // ?auto=walkthrough.json: plays it by itself (testing, videos: player/autopilot.js)
  if (params.get("auto")) {
    const { runAutopilot } = await import("./autopilot.js");
    runAutopilot({
      esc, gameUI, canvas, params,
      cam: () => ({ x: -esc.camera[4] / esc.camera[0], y: -esc.camera[5] / esc.camera[3] }),
      ended: () => ended,
      hover: driverInput.hover,
      click: driverInput.click,
    });
  }
}

// Input from a test driver (autopilot.js, geje_test.js), in canvas pixels:
// what the handlers below do with the real mouse and keyboard
const driverInput = {
  // the mouse goes to s (hover)
  hover(s) {
    mouse = s;
    if (menus.open) return menus.pointerMove(s);
    if (!esc.view) return;
    esc.input({ kind: "mouse_motion", x: s.x, y: s.y });
    if (esc.controls.move(s)) gameUI.pointerMove(null, null);
    else gameUI.pointerMove(s, roomPoint(s));
  },
  // press, release and click there (double: the second click of a double click)
  click(s, button = 0, double = false) {
    if (ended) return;
    if (menus.open) {
      menus.pointerDown(s, button);
      menus.pointerUp(s, button);
      return;
    }
    menuClick = false;
    swallowed = press(s, button, double);
    release(s, button);
    click({ __point: s }, button, double);
  },
  // the mouse wheel (dy > 0: down)
  wheel(dy) {
    const s = mouse || { x: view.w / 2, y: view.h / 2 };
    if (menus.open) menus.wheel(dy, s);
    else if (esc.view) esc.controls.wheel(s, dy) || gameUI.wheel?.(dy);
  },
  // manual frames (on: the browser's clock no longer moves the game)
  setManual(on) {
    manual = !!on;
  },
  step: (dt) => step(dt),
  // what the last frame drew; f() after every frame
  drawn: () => lastDrawn,
  afterFrame: (f) => afterFrame.push(f),
  // a key pressed and released (e.key: " ", "Escape"...)
  key(k) {
    const e = { key: k, repeat: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {} };
    onKeyDown(e);
    onKeyUp(e);
  },
};

let last = 0;
let lastCursor = "";
// what shows where nothing is drawn: rendering/environment/defaults/default_clear_color (Godot: 0.3 gray)
let clearColor = "#4d4d4d";
// what the last frame drew (render.js collect() items) and who wants to know
// when a frame is done (the test's checks, player/checks.js)
let lastDrawn = [];
const afterFrame = [];
// the Escoria Mobile addon's JS side: f(dt) before each frame (its layout),
// f(ctx) after it is drawn, in game units (its tab and buttons)
const beforeFrame = [], overlays = [];
// manual: the frames come from a test driver (geje.record(): a fixed step of
// game time per frame, whatever the real time), not from the browser's clock
let manual = false;
// the spinner (index.html #msg): from the start until the game is ready, and
// then whenever pictures or fonts have been downloading for a while (a room
// whose pictures haven't arrived yet would be black)
let downloadingSince = 0;
function loadingShown(on) {
  const m = document.getElementById("msg");
  if (!m) return;
  m.classList.toggle("hidden", !on);
  m.classList.add("over"); // after the first load: over the game, dimming it
}
function updateLoading(t) {
  if (!game.downloading()) {
    if (downloadingSince) loadingShown(false);
    downloadingSince = 0;
  } else if (!downloadingSince) downloadingSince = t;
  else if (t - downloadingSince > 300) loadingShown(true);
}
function frame(t) {
  updateLoading(t);
  const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
  last = t;
  if (!manual) step(dt);
  requestAnimationFrame(frame);
}
/** One frame: the game advances dt seconds (scaled by its time scale), then it is drawn. */
function step(dt) {
  for (const f of beforeFrame) f(dt);
  lastDrawn = [];
  // the main menu doesn't pause the game (show_menu("main") + wait + hide_menu)
  if (!menus.paused && (!menus.open || esc.view)) {
    gameUI.update(dt);
    esc.update(dt);
  }
  // the UI's cursor can change without the mouse moving (simplemouse: the verb)
  const cursor = menus.open ? "" : esc.controls.cursor || gameUI.cursor || "";
  if (cursor !== lastCursor) canvas.style.cursor = lastCursor = cursor;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = clearColor;
  ctx.fillRect(0, 0, view.w, view.h);
  if (ended) {
    // the window would close in Godot: an end screen, a click starts again
    ctx.fillStyle = "#aaa";
    ctx.font = "48px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("The End", view.w / 2, view.h / 2);
    ctx.font = "24px system-ui, sans-serif";
    ctx.fillStyle = "#666";
    ctx.fillText("Click to play again", view.w / 2, view.h / 2 + 50);
    ctx.textAlign = "start";
  } else if (menus.open) menus.draw(ctx, mouse);
  else if (esc.view) {
    ctx.imageSmoothingEnabled = canvas.style.imageRendering !== "pixelated";
    ctx.imageSmoothingQuality = "high"; // HD sprites drawn smaller than their pictures
    const cam = roomTransform();
    esc.camera = cam;
    // the room; its CanvasLayers above the game UI's (layer 1) after the UI
    const roomItems = collect(esc.shownView.room, cam) /* the previous room until the new one's :setup ends */;
    draw(ctx, game, roomItems.filter((it) => it.layer <= 1));
    gameUI.drawSpeech(ctx, cam);
    gameUI.draw(ctx, mouse);
    draw(ctx, game, roomItems.filter((it) => it.layer > 1));
    screenItems = collect(esc.screenRoot); // spawn()ed scenes: on top, like Godot's /root
    draw(ctx, game, screenItems.filter((it) => it.layer <= TRANSITION_LAYER));
    drawPopup(ctx); // an open OptionButton list
    lastDrawn = [...roomItems, ...screenItems];
  }
  if (esc.view && !ended) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    esc.transitions.draw(ctx, view.w, view.h); // layers/curtain (layer 20)
    // CanvasLayers above the curtain (a game's end screen at layer 30)
    const above = screenItems.filter((it) => it.layer > TRANSITION_LAYER);
    if (above.length) draw(ctx, game, above);
  }
  screenItems = [];
  if (overlays.length && !ended) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const f of overlays) f(ctx);
  }
  // RenderingServer.frame_post_draw: every frame, as in Godot, even with no
  // room on screen (a game's start script can wait for it before its first room)
  esc.frameDrawn();
  for (const f of afterFrame) f();
}

// What the Escoria Mobile addon's layout (src/compat/escoria_mobile/layout.js)
// changes in the player: the game's view size (the room fills the screen),
// and its hooks into each frame.
const mobileHost = {
  view,
  get esc() { return esc; },
  get gameUI() { return gameUI; },
  get menus() { return menus; },
  /** The game's view becomes w x h game units (the canvas keeps the window's shape). */
  setView(w, h) {
    view.w = w;
    view.h = h;
    fitCanvas();
    if (gameUI) [gameUI.W, gameUI.H] = [w, h];
    if (esc) [esc.cameraPlayer.W, esc.cameraPlayer.H] = [w, h];
  },
  onFrame: (f) => beforeFrame.push(f),
  onDraw: (f) => overlays.push(f),
  /** A key pressed and released, as from the keyboard (Escape: the game's scripts, then the pause menu). */
  key: (k) => driverInput.key(k),
};

// The player's input for the Escoria Mobile addon's gestures
// (src/compat/escoria_mobile/gestures.js), in game units.
const touchPointer = {
  toGame: (clientX, clientY) => screenPoint({ clientX, clientY }),
  hover: (s) => driverInput.hover(s),
  click(s, button = 0, double = false) {
    if (ended) return location.reload(); // the end screen: a tap starts again
    driverInput.click(s, button, double);
  },
  /** Does a tap there go to the GUI (or is the room not taking input), not to an item or the floor? */
  isGui(s) {
    if (ended || !esc || !esc.view || menus.open) return true;
    if (clickWaiters.length || gameUI.chooser || gameUI.speech) return true;
    if (esc.state !== "DEFAULT" || esc.inputMode !== "ALL") return true;
    return !!(esc.controls.hit(s) || gameUI.overPanel?.(s.x, s.y));
  },
  item: () => (esc && esc.hoveredItem) || null,
};

// ------------------------------------------------------------------ input
// A mouse button or a key goes first to the game scripts' _input
// (esc.input), then to the Controls of the scenes, then to their
// _unhandled_input, and last to the game UI. A click whose press a script
// took (set_input_as_handled) doesn't reach the game.

function screenPoint(e) {
  if (e.__point) return e.__point;
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * view.w, y: ((e.clientY - r.top) / r.height) * view.h };
}
const roomPoint = (s) => {
  const m = esc.camera;
  return { x: (s.x - m[4]) / m[0], y: (s.y - m[5]) / m[3] };
};
const GODOT_BUTTON = [1, 3, 2]; // browser button -> Godot's MOUSE_BUTTON_*
const mouseEvent = (p, button, pressed, double = false) => ({ kind: "mouse_button", x: p.x, y: p.y, button: GODOT_BUTTON[button] ?? 1, pressed, double });
const keyEvent = (e, pressed) => ({ kind: "key", key: e.key, repeat: e.repeat, pressed, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey });
let swallowed = false; // the press of this click was taken by a script or a Control
let menuClick = false; // this click was the menu's (it may have closed it)
let pressedAfterEnd = false; // the click began on the end screen (not the one that ended the game)

function click(e, button, doubleClick) {
  e.preventDefault?.();
  if (ended) {
    if (pressedAfterEnd) location.reload();
    return;
  }
  if (!esc || !esc.view || menus.open || swallowed || menuClick) return;
  if (clickWaiters.length) {
    const w = clickWaiters;
    clickWaiters = [];
    w.forEach((f) => f());
    return;
  }
  const s = screenPoint(e);
  if (esc.controls.hit(s)) return; // Controls take mousedown / mouseup
  if (gameUI.chooser) return gameUI.clickChooser(s);
  if (gameUI.speech) return gameUI.clickSpeech();
  if (gameUI.clickPanel(s.x, s.y, button)) return;
  gameUI.clickRoom(roomPoint(s), button, doubleClick);
}

// a press: scripts' _input, Controls, _unhandled_input. True if one of them took it.
function press(p, button, double) {
  const raw = mouseEvent(p, button, true, double);
  if (esc.input(raw)) return true;
  if (esc.controls.down(p, button)) return true;
  return esc.unhandledInput(raw);
}
function release(p, button) {
  const raw = mouseEvent(p, button, false);
  if (esc.input(raw)) return true;
  if (esc.controls.up(p, button)) return true;
  return esc.unhandledInput(raw);
}
// Input.parse_input_event(): an event a script sends goes the whole way again (a press is then a click)
ui.injectInput = (raw) => {
  if (!esc || !esc.view || ended) return;
  if (raw.kind === "key") {
    if (!esc.input(raw)) esc.unhandledInput(raw);
    return;
  }
  if (raw.kind !== "mouse_button") return esc.input(raw);
  const p = { x: raw.x, y: raw.y }, button = [0, 0, 2, 1][raw.button] ?? 0;
  if (!raw.pressed) return release(p, button);
  menuClick = false;
  swallowed = press(p, button, raw.double);
  if (!swallowed) click({ __point: p }, button, !!raw.double);
};

canvas.addEventListener("click", (e) => click(e, 0, false));
canvas.addEventListener("dblclick", (e) => click(e, 0, true));
canvas.addEventListener("contextmenu", (e) => click(e, 2, false));
canvas.addEventListener("mousedown", (e) => {
  pressedAfterEnd = ended;
  if (menus && menus.open && e.button === 0) {
    // the menu takes this click: its mouseup / click don't reach the game
    // (a menu button that closes it, like New game, would also click the room)
    menuClick = true;
    return menus.pointerDown(screenPoint(e), e.button);
  }
  swallowed = false;
  menuClick = false;
  if (esc && esc.view && !ended) swallowed = press(screenPoint(e), e.button, e.detail === 2);
});
window.addEventListener("mouseup", (e) => {
  if (menus) menus.pointerUp(screenPoint(e), e.button);
  if (esc && esc.view && !ended && !(menus && menus.open) && !menuClick) release(screenPoint(e), e.button);
});
canvas.addEventListener("mousemove", (e) => {
  mouse = screenPoint(e);
  if (!menus) return;
  if (menus.open) return menus.pointerMove(mouse);
  if (esc.view) {
    esc.input({ kind: "mouse_motion", x: mouse.x, y: mouse.y });
    if (esc.controls.move(mouse)) gameUI.pointerMove(null, null);
    else gameUI.pointerMove(mouse, roomPoint(mouse));
  }
});
canvas.addEventListener("mouseleave", () => {
  mouse = null;
  if (gameUI) gameUI.pointerMove(null, null);
});
canvas.addEventListener("wheel", (e) => {
  if (menus && menus.open) {
    e.preventDefault();
    menus.wheel(e.deltaY, screenPoint(e));
  } else if (esc && esc.view && (esc.controls.wheel(screenPoint(e), e.deltaY) || gameUI.wheel?.(e.deltaY))) e.preventDefault();
}, { passive: false });
window.addEventListener("keydown", (e) => onKeyDown(e));
window.addEventListener("keyup", (e) => onKeyUp(e));
function onKeyDown(e) {
  if (!menus || !esc.view || ended) return;
  if (!menus.open) {
    const raw = keyEvent(e, true);
    if (esc.input(raw)) return e.preventDefault();
    if (esc.controls.key(e)) return e.preventDefault();
    if (esc.unhandledInput(raw)) return e.preventDefault();
    if (esc.key(e)) return e.preventDefault();
  }
  if (menus.open ? menus.key(e) : e.key === "Escape" && (menus.showPause(), true)) e.preventDefault();
}
function onKeyUp(e) {
  if (menus && esc && esc.view && !ended && !menus.open) {
    const raw = keyEvent(e, false);
    if (!esc.input(raw)) esc.unhandledInput(raw);
  }
}

start().catch((e) => {
  const m = document.getElementById("msg");
  if (m) {
    m.className = "error";
    m.querySelector(".text").textContent = "Error: " + e.message;
  }
  console.error(e);
});
