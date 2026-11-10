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

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
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
    c.getContext("2d").drawImage(canvas, 0, 0, w, h, 0, 0, w, h);
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
  const exports = await fetch("../out/exports.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const name = params.get("game") || (exports.includes("openquest-escoria") ? "openquest-escoria" : exports[0]);
  game = await GameData.load(`../out/${name}/`);
  document.title = game.json.name || name;
  canvas.width = game.setting("display/window/size/viewport_width", 1152);
  canvas.height = game.setting("display/window/size/viewport_height", 648);
  if (game.setting("rendering/textures/canvas_textures/default_texture_filter", 1) !== 0) canvas.style.imageRendering = "auto";
  esc = new Escoria(game, { log, ui });
  clearColor = cssColor(game.setting("rendering/environment/defaults/default_clear_color", { type: "Color", args: [0.3, 0.3, 0.3, 1] }));
  await loadPorts(esc); // the game's own scripts (js_ports/), if it brings them
  gameUI = await createGameUI(esc, canvas.width, canvas.height);
  // the game's own menu scenes (translated scripts), else its ports' menus, else the engine's
  menus = SceneMenus.create(esc, gameUI.scene) || (await Menus.create(esc, gameUI.scene, canvas.width, canvas.height));
  esc.menus = menus;
  esc.settings = menus.settings;
  if (menus.settings.lang && game.locales().includes(menus.settings.lang)) game.locale = menus.settings.lang;
  document.getElementById("msg").remove();
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
  // window.__probe for tools/compare (an outside driver with the real mouse)
  installProbe({ esc, gameUI, canvas, cam: () => ({ x: -esc.camera[4] / esc.camera[0], y: -esc.camera[5] / esc.camera[3] }), ended: () => ended });
  // ?auto=walkthrough.json: plays it by itself (testing, videos: player/autopilot.js)
  if (params.get("auto")) {
    const { runAutopilot } = await import("./autopilot.js");
    runAutopilot({
      esc, gameUI, canvas, params,
      cam: () => ({ x: -esc.camera[4] / esc.camera[0], y: -esc.camera[5] / esc.camera[3] }),
      ended: () => ended,
      // the mouse goes to s (hover), then press / release / click as the player's handlers do
      hover(s) {
        mouse = s;
        esc.input({ kind: "mouse_motion", x: s.x, y: s.y });
        if (esc.controls.move(s)) gameUI.pointerMove(null, null);
        else gameUI.pointerMove(s, roomPoint(s));
      },
      click(s, button = 0) {
        if (ended) return;
        if (menus.open) {
          menus.pointerDown(s, button);
          menus.pointerUp(s, button);
          return;
        }
        menuClick = false;
        swallowed = press(s, button, false);
        release(s, button);
        click({ __point: s }, button, false);
      },
    });
  }
}

let last = 0;
let lastCursor = "";
// what shows where nothing is drawn: rendering/environment/defaults/default_clear_color (Godot: 0.3 gray)
let clearColor = "#4d4d4d";
function frame(t) {
  const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
  last = t;
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
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (ended) {
    // the window would close in Godot: an end screen, a click starts again
    ctx.fillStyle = "#aaa";
    ctx.font = "48px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("The End", canvas.width / 2, canvas.height / 2);
    ctx.font = "24px system-ui, sans-serif";
    ctx.fillStyle = "#666";
    ctx.fillText("Click to play again", canvas.width / 2, canvas.height / 2 + 50);
    ctx.textAlign = "start";
  } else if (menus.open) menus.draw(ctx, mouse);
  else if (esc.view) {
    ctx.imageSmoothingEnabled = canvas.style.imageRendering !== "pixelated";
    const cam = roomTransform();
    esc.camera = cam;
    // the room; its CanvasLayers above the game UI's (layer 1) after the UI
    const roomItems = collect(esc.shownView.room, cam) /* the previous room until the new one's :setup ends */;
    draw(ctx, game, roomItems.filter((it) => it.layer <= 1));
    gameUI.drawSpeech(ctx, cam);
    gameUI.draw(ctx, mouse);
    draw(ctx, game, roomItems.filter((it) => it.layer > 1));
    draw(ctx, game, collect(esc.screenRoot)); // spawn()ed scenes: on top, like Godot's /root
    drawPopup(ctx); // an open OptionButton list
    esc.frameDrawn();
  }
  if (esc.view && !ended) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    esc.transitions.draw(ctx, canvas.width, canvas.height); // layers/curtain (layer 20)
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ input
// A mouse button or a key goes first to the game scripts' _input
// (esc.input), then to the Controls of the scenes, then to their
// _unhandled_input, and last to the game UI. A click whose press a script
// took (set_input_as_handled) doesn't reach the game.

function screenPoint(e) {
  if (e.__point) return e.__point;
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
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
window.addEventListener("keydown", (e) => {
  if (!menus || !esc.view || ended) return;
  if (!menus.open) {
    const raw = keyEvent(e, true);
    if (esc.input(raw)) return e.preventDefault();
    if (esc.controls.key(e)) return e.preventDefault();
    if (esc.unhandledInput(raw)) return e.preventDefault();
    if (esc.key(e)) return e.preventDefault();
  }
  if (menus.open ? menus.key(e) : e.key === "Escape" && (menus.showPause(), true)) e.preventDefault();
});
window.addEventListener("keyup", (e) => {
  if (menus && esc && esc.view && !ended && !menus.open) {
    const raw = keyEvent(e, false);
    if (!esc.input(raw)) esc.unhandledInput(raw);
  }
});

start().catch((e) => {
  const m = document.getElementById("msg");
  if (m) m.textContent = "Error: " + e.message;
  console.error(e);
});
