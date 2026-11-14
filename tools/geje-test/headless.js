// A headless player: an exported game (geje-builds/<game>/) running in Node,
// without a browser and without drawing, on a virtual clock (a wait of 10 s
// takes no real time). It does what player/player.js does (the game's UI,
// its menus, the input path of a click: scripts' _input, Controls,
// _unhandled_input, the game UI) and gives the same window.__probe
// (player/probe.js) that tools/compare/run.js drives in the browser.
//
// Keep it in step with player/player.js: what it doesn't copy, the fast test
// doesn't test (drawing, the cursor, the end screen).
//
// One game per process: the engine keeps module state (setGame) and these
// stubs are global.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const engineDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ------------------------------------------------------------------ clock, random

export const clock = { t: 0 }; // virtual seconds
Object.defineProperty(globalThis, "performance", { value: { now: () => clock.t * 1000 }, configurable: true, writable: true });
// a fixed seed: the same run every time (shuffled puzzles, rand_global)
let seed = 0x2545f491;
Math.random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};

// ------------------------------------------------------------------ the little of the browser the engine touches

const problems = []; // {kind, msg}: missing files, console errors
export const noteProblem = (kind, msg) => problems.push({ kind, msg, t: +clock.t.toFixed(2) });
export const takeProblems = () => problems.splice(0);

function stubContext() {
  const st = { font: "10px sans-serif" };
  const fn = () => {};
  return new Proxy(st, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === "measureText") return (s) => {
        const px = +(/(\d+(?:\.\d+)?)px/.exec(o.font) || [0, 10])[1];
        return { width: String(s).length * px * 0.55, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.2 };
      };
      if (k === "getImageData") return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) });
      if (k === "createImageData") return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) });
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern") return () => ({ addColorStop: fn });
      if (k === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return fn;
    },
    set(o, k, v) {
      o[k] = v;
      return true;
    },
  });
}
const stubCanvas = () => ({ width: 300, height: 150, style: {}, getContext: (t) => (t === "2d" ? stubContext() : null), toDataURL: () => "", addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }) });

globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  title: "",
  fullscreenElement: null,
  documentElement: { requestFullscreen: async () => {} },
  body: { appendChild() {} },
  fonts: { add() {}, load: async () => [], check: () => true, ready: Promise.resolve() },
  createElement: (tag) => (tag === "canvas" ? stubCanvas() : { style: {}, appendChild() {}, remove() {} }),
  getElementById: () => null,
};
Object.defineProperty(globalThis, "navigator", { value: { language: "en-US", languages: ["en-US"] }, configurable: true, writable: true });
globalThis.FontFace = class { constructor(family) { this.family = family; } async load() { return this; } };
globalThis.Audio = class {
  constructor(u) { this.src = u; this.paused = true; this.currentTime = 0; this.volume = 1; this.loop = false; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener() {}
  removeEventListener() {}
};
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

let gameDir = null;
let imageSizes = {};
const fileOf = (u) => {
  u = String(u);
  if (u.startsWith("file://")) return fileURLToPath(u.split(/[?#]/)[0]);
  return path.join(gameDir, decodeURIComponent(u.replace(/^\.\//, "").split(/[?#]/)[0]));
};
globalThis.fetch = async (u) => {
  const f = fileOf(u);
  if (!fs.existsSync(f)) {
    noteProblem("missing-file", path.relative(engineDir, f));
    return { ok: false, status: 404, text: async () => "", json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) };
  }
  const buf = fs.readFileSync(f);
  return { ok: true, status: 200, text: async () => buf.toString("utf8"), json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
// an image: its size (game.json's imageSizes, else the file's header), never its pixels
globalThis.Image = class {
  constructor() { this.width = 0; this.height = 0; this.onload = null; this.onerror = null; }
  set src(u) {
    this._src = u;
    const f = fileOf(u);
    queueMicrotask(() => {
      if (!fs.existsSync(f)) {
        noteProblem("missing-image", path.relative(engineDir, f));
        return this.onerror && this.onerror(new Error("missing"));
      }
      const res = "res://" + path.relative(path.join(gameDir, "res"), f).split(path.sep).join("/");
      const known = imageSizes[res];
      const [w, h] = known || headerSize(f);
      this.width = this.naturalWidth = w;
      this.height = this.naturalHeight = h;
      this.onload && this.onload();
    });
  }
  get src() { return this._src; }
};
function headerSize(f) {
  const b = fs.readFileSync(f);
  if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (kind === "VP8L") { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length - 8; ) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  const svg = /<svg[^>]*\swidth="([\d.]+)[^"]*"[^>]*\sheight="([\d.]+)/.exec(b.toString("utf8", 0, 2000));
  return svg ? [+svg[1], +svg[2]] : [64, 64];
}

// ------------------------------------------------------------------ the game

const imp = (f) => import(pathToFileURL(path.join(engineDir, f)).href);

/**
 * Boots geje-builds/<name>/ as player/player.js does (:init) and returns the
 * headless player: tick(dt), click/hover/wheel/key like the player's
 * handlers, the probe, and hooks to watch the engine.
 */
export async function openGame(name, { log = () => {} } = {}) {
  gameDir = path.join(engineDir, "geje-builds", name);
  globalThis.location = { href: pathToFileURL(gameDir + "/").href, search: "", reload() {} };
  const { GameData } = await imp("src/godot/game_data.js");
  const { collect, draw } = await imp("src/godot/render.js");
  const { drawPopup } = await imp("src/godot/controls.js");
  const { Escoria } = await imp("src/escoria/escoria.js");
  const { loadPorts } = await imp("src/escoria/ports.js");
  const { createGameUI } = await imp("src/escoria/ui/simplemouse_ui.js");
  const { Menus } = await imp("src/escoria/ui/menus.js");
  const { SceneMenus } = await imp("src/escoria/ui/scene_menus.js");
  const { installProbe } = await imp("player/probe.js");

  const json = JSON.parse(fs.readFileSync(path.join(gameDir, "game.json"), "utf8"));
  imageSizes = json.imageSizes || {};
  const game = new GameData(pathToFileURL(gameDir + "/").href, json);
  const canvas = stubCanvas();
  canvas.width = game.setting("display/window/size/viewport_width", 1152);
  canvas.height = game.setting("display/window/size/viewport_height", 648);

  let esc, gameUI, menus;
  let clickWaiters = [];
  let ended = false;
  const said = []; // lines of this step
  const ui = {
    say: (obj, text, { cmd, key, type } = {}) => {
      said.push(`${obj && obj.globalId}: ${text}`);
      return gameUI.say(obj, text, cmd, key, type);
    },
    chooseDialogOption: (dialog) => gameUI.chooseDialogOption(dialog),
    setGuiVisible(v) { if (gameUI) gameUI.visible = v; },
    waitClick: () => new Promise((ok) => clickWaiters.push(ok)),
    roomChanged() {},
    captureScreen: (w, h) => Object.assign(stubCanvas(), { width: w, height: h }),
    gameLoading() {
      if (!gameUI) return;
      gameUI.endSpeech();
      if (gameUI.chooser) gameUI.choose(null);
      gameUI.clearTooltip();
    },
    languageChanged() { gameUI?.updateSentence(); },
    quit() { ended = true; },
    applySettings() { esc.applyVolumes(); },
  };
  const engineLog = (msg, level) => {
    if (level === "error") noteProblem("engine-error", String(msg));
    else if (level === "warning" || level === "warn") noteProblem("engine-warning", String(msg));
    log(msg, level);
  };
  esc = new Escoria(game, { log: engineLog, ui });
  await loadPorts(esc);
  gameUI = await createGameUI(esc, canvas.width, canvas.height);
  menus = SceneMenus.create(esc, gameUI.scene) || (await Menus.create(esc, gameUI.scene, canvas.width, canvas.height));
  esc.menus = menus;
  esc.settings = menus.settings;
  if (menus.settings.lang && game.locales().includes(menus.settings.lang)) game.locale = menus.settings.lang;
  // the walkthroughs name options by their English text (run.js: browser locale en-US)
  esc.camera = [1, 0, 0, 1, 0, 0];

  let mouse = null;
  const cam = () => ({ x: -esc.camera[4] / esc.camera[0], y: -esc.camera[5] / esc.camera[3] });
  const win = globalThis.window;
  installProbe({ esc, gameUI, canvas, cam, ended: () => ended, waitingClick: () => clickWaiters.length > 0 });
  const probe = win.__probe;

  // ---- frames (player.js frame(), drawing on a canvas that keeps nothing:
  // the UI finds what the mouse is over while it draws)
  const TRANSITION_LAYER = 20;
  const ctx = canvas.getContext("2d");
  const tickers = [];
  let drawn = []; // what was drawn this frame (render.js collect() items)
  const tick = (dt) => {
    clock.t += dt;
    if (!menus.paused && (!menus.open || esc.view)) {
      gameUI.update(dt);
      esc.update(dt);
    }
    let screenItems = [];
    drawn = [];
    if (ended) {
      // the end screen
    } else if (menus.open) menus.draw(ctx, mouse);
    else if (esc.view) {
      const m = esc.cameraPlayer.transform();
      const cam = [m[0], 0, 0, m[3], Math.round(m[4]), Math.round(m[5])];
      esc.camera = cam;
      const roomItems = collect(esc.shownView.room, cam);
      draw(ctx, game, roomItems.filter((it) => it.layer <= 1));
      gameUI.drawSpeech(ctx, cam);
      gameUI.draw(ctx, mouse);
      draw(ctx, game, roomItems.filter((it) => it.layer > 1));
      screenItems = collect(esc.screenRoot);
      draw(ctx, game, screenItems.filter((it) => it.layer <= TRANSITION_LAYER));
      drawPopup(ctx);
      drawn = [...roomItems, ...screenItems];
      esc.frameDrawn();
    }
    if (esc.view && !ended) {
      esc.transitions.draw(ctx, canvas.width, canvas.height);
      const above = screenItems.filter((it) => it.layer > TRANSITION_LAYER);
      if (above.length) draw(ctx, game, above);
    }
    for (const f of tickers) f(dt);
  };

  // ---- input (player.js)
  let swallowed = false;
  const roomPoint = (s) => ({ x: (s.x - esc.camera[4]) / esc.camera[0], y: (s.y - esc.camera[5]) / esc.camera[3] });
  const GODOT_BUTTON = [1, 3, 2];
  const mouseEvent = (p, button, pressed, double = false) => ({ kind: "mouse_button", x: p.x, y: p.y, button: GODOT_BUTTON[button] ?? 1, pressed, double });
  const press = (p, button, double) => {
    const raw = mouseEvent(p, button, true, double);
    if (esc.input(raw)) return true;
    if (esc.controls.down(p, button)) return true;
    return esc.unhandledInput(raw);
  };
  const release = (p, button) => {
    const raw = mouseEvent(p, button, false);
    if (esc.input(raw)) return true;
    if (esc.controls.up(p, button)) return true;
    return esc.unhandledInput(raw);
  };
  const clickHandler = (s, button, doubleClick) => {
    if (ended || !esc.view || menus.open || swallowed) return;
    if (clickWaiters.length) {
      const w = clickWaiters;
      clickWaiters = [];
      w.forEach((f) => f());
      return;
    }
    if (esc.controls.hit(s)) return;
    if (gameUI.chooser) return gameUI.clickChooser(s);
    if (gameUI.speech) return gameUI.clickSpeech();
    if (gameUI.clickPanel(s.x, s.y, button)) return;
    gameUI.clickRoom(roomPoint(s), button, doubleClick);
  };
  ui.injectInput = (raw) => {
    if (!esc.view || ended) return;
    if (raw.kind === "key") {
      if (!esc.input(raw)) esc.unhandledInput(raw);
      return;
    }
    if (raw.kind !== "mouse_button") return esc.input(raw);
    const p = { x: raw.x, y: raw.y }, button = [0, 0, 2, 1][raw.button] ?? 0;
    if (!raw.pressed) return release(p, button);
    swallowed = press(p, button, raw.double);
    if (!swallowed) clickHandler(p, button, !!raw.double);
  };
  const player = {
    esc, gameUI, menus, game, canvas, probe, clock, tick, tickers, said,
    size: { w: canvas.width, h: canvas.height },
    ended: () => ended,
    drawn: () => drawn,
    hover(s) {
      mouse = s;
      if (menus.open) return menus.pointerMove(s);
      if (!esc.view) return;
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
      if (!esc.view) return;
      swallowed = press(s, button, false);
      release(s, button);
      clickHandler(s, button, false);
      swallowed = false;
    },
    wheel(dy) {
      if (menus.open) return menus.wheel(dy, mouse || { x: 0, y: 0 });
      if (esc.view) esc.controls.wheel(mouse || { x: 0, y: 0 }, dy) || gameUI.wheel?.(dy);
    },
    key(k) {
      const e = { key: k, repeat: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {} };
      if (!esc.view || ended) return;
      for (const pressed of [true, false]) {
        const raw = { kind: "key", key: k, repeat: false, pressed, shift: false, ctrl: false, alt: false, meta: false };
        if (!pressed) {
          if (!menus.open && !esc.input(raw)) esc.unhandledInput(raw);
          continue;
        }
        if (!menus.open) {
          if (esc.input(raw) || esc.controls.key(e) || esc.unhandledInput(raw) || esc.key(e)) continue;
        }
        if (menus.open) menus.key(e);
        else if (k === "Escape") menus.showPause();
      }
    },
  };
  esc.runStartEvent("init");
  return player;
}
