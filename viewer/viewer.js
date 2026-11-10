// Room viewer: plays an exported game's rooms with the Escoria runtime (ESC
// scripts, walking, say), with debug overlays and a log, to compare against
// the game in Godot.
//   viewer/?game=openquest-escoria&room=res://rooms/office_room/office_room.tscn
//   viewer/?game=openquest-escoria&start=1     (new game, from :init)
import { GameData } from "../src/godot/game_data.js";
import { collect, draw, globalTransform, apply, multiply, invert, spriteFrame, spriteRect } from "../src/godot/render.js";
import { drawPopup } from "../src/godot/controls.js";
import { points, list, vec2, cssColor } from "../src/godot/values.js";
import { listRooms, isItem } from "../src/escoria/room.js";
import { Escoria } from "../src/escoria/escoria.js";
import { loadPorts } from "../src/escoria/ports.js";
import { GameUI, itemShapes } from "../src/escoria/ui/game_ui.js";
import { Menus } from "../src/escoria/ui/menus.js";
import { SceneMenus } from "../src/escoria/ui/scene_menus.js";

const $ = (id) => document.getElementById(id);
const canvas = $("screen");
const ctx = canvas.getContext("2d");
const params = new URLSearchParams(location.search);

let game = null;
let esc = null;
let camX = 0, camY = 0;
let mouse = null;
let follow = true; // camera follows the player until the scroll bar is used
let gameUI = null; // the game scene: verbs, sentence line, speech
let menus = null; // pause / save / load / options
let clickWaiters = [];


// ------------------------------------------------------------------ log

const fmt = (p) => (p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})` : "-");
function log(msg, level = "info") {
  if (level === "command" && !$("logcmd").checked) return;
  if (level === "global" && !$("logglobal").checked) return;
  const el = $("log");
  const line = document.createElement("div");
  line.className = level;
  line.textContent = `${(performance.now() / 1000).toFixed(2)}  ${msg}`;
  el.append(line);
  while (el.children.length > 1000) el.firstChild.remove();
  el.scrollTop = el.scrollHeight;
  if (level === "error") console.warn(msg);
}
$("logcopy").onclick = (e) => {
  e.preventDefault();
  navigator.clipboard.writeText($("log").innerText);
};
$("logclear").onclick = (e) => {
  e.preventDefault();
  $("log").innerHTML = "";
};

// ------------------------------------------------------------------ ui for the runtime

const ui = {
  say(obj, text, { cmd } = {}) {
    log(`${obj.globalId}: «${text}»`, "say");
    return gameUI.say(obj, text, cmd);
  },
  chooseDialogOption(dialog) {
    log(`options: ${dialog.options.map((o) => o.text).join(" | ")}`, "say");
    return gameUI.chooseDialogOption(dialog).then((o) => {
      if (o) log(`chosen option: ${o.text}`, "say");
      return o;
    });
  },
  setGuiVisible(v) {
    if (gameUI) gameUI.visible = v;
  },
  waitClick() {
    return new Promise((ok) => clickWaiters.push(ok));
  },
  roomChanged() {
    setupCamera();
    buildStates();
    buildEvents();
    $("room").value = esc.view.room.sceneFile;
  },
  // the picture on screen now (top-left w x h), for transitions
  captureScreen(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(canvas, 0, 0, w, h, 0, 0, w, h);
    return c;
  },
  // a saved game starts loading / a new game starts: clear what was on screen
  gameLoading() {
    if (!gameUI) return; // before the UI exists (a game script at startup)
    gameUI.endSpeech();
    if (gameUI.chooser) gameUI.choose(null);
    gameUI.clearTooltip();
  },
  applySettings(s) {
    esc.applyVolumes();
    if (s.fullscreen && !document.fullscreenElement) canvas.requestFullscreen?.().catch(() => {});
    else if (!s.fullscreen && document.fullscreenElement) document.exitFullscreen?.();
  },
  // the language changed in the options: the sentence line is built again
  languageChanged() {
    gameUI?.updateSentence(); // the game's scripts can change it before the UI exists (first_run_locale.gd)
  },
  quit() {
    log("the game ended: no more events or input (reload to start again)", "event");
  },
};

// ------------------------------------------------------------------ start

async function start() {
  const exports = await fetch("../out/exports.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const gameName = params.get("game") || (exports.includes("openquest-escoria") ? "openquest-escoria" : exports[0]);
  for (const e of exports) $("game").add(new Option(e, e, false, e === gameName));
  $("game").onchange = () => go({ game: $("game").value });
  if (!gameName) throw new Error("No exported games: run tools/export.js");

  game = await GameData.load(`../out/${gameName}/`);
  canvas.width = game.setting("display/window/size/viewport_width", 1152);
  canvas.height = game.setting("display/window/size/viewport_height", 648);
  const nearest = game.setting("rendering/textures/canvas_textures/default_texture_filter", 1) === 0;
  canvas.style.imageRendering = nearest ? "pixelated" : "auto";

  esc = new Escoria(game, { log, ui });
  await loadPorts(esc); // the game's own scripts (js_ports/), if it brings them
  gameUI = await GameUI.create(esc, canvas.width, canvas.height);
  // the game's own menu scenes (translated scripts), else its ports' menus, else the engine's
  menus = SceneMenus.create(esc, gameUI.scene) || (await Menus.create(esc, gameUI.scene, canvas.width, canvas.height));
  esc.menus = menus;
  esc.settings = menus.settings;
  if (menus.settings.lang && game.locales().includes(menus.settings.lang)) game.locale = menus.settings.lang;
  const missing = [...esc.commands.values()].filter((c) => c.missing).map((c) => c.name);
  log(`${gameName}: ${esc.commands.size} ESC commands, ${missing.length} not ported yet`);

  const rooms = listRooms(game);
  for (const r of rooms) $("room").add(new Option(r.id, r.file));
  $("room").onchange = () => go({ game: gameName, room: $("room").value });
  $("newgame").onclick = () => go({ game: gameName, start: 1 });

  requestAnimationFrame(frame);
  if (params.get("start")) {
    esc.runStartEvent("init");
  } else {
    const roomFile = params.get("room") || (rooms.find((r) => /office/.test(r.file)) || rooms[0]).file;
    // a room on its own: first the state the start script sets up (globals,
    // inventory), as a new game would
    await esc.runStateOf(game.setting("escoria/main/game_start_script", ""), "init");
    await esc.changeScene(roomFile);
  }
}

function go(p) {
  location.search = new URLSearchParams(p).toString();
}

// ------------------------------------------------------------------ camera

function setupCamera() {
  const lim = esc.view.limits[0] || { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const maxX = Math.max(lim.x, lim.x + lim.w - canvas.width);
  let target = lim.x;
  if (esc.player) target = esc.player.position.x - canvas.width / 2;
  camX = Math.round(Math.min(Math.max(target, lim.x), maxX));
  camY = lim.y;
  const s = $("scroll");
  s.hidden = maxX <= lim.x;
  s.min = lim.x;
  s.max = maxX;
  s.value = camX;
  s.oninput = () => {
    camX = +s.value;
    follow = false;
  };
}

function followPlayer() {
  const s = $("scroll");
  if (s.hidden || !esc.player) return;
  const x = esc.player.position.x - canvas.width / 2;
  camX = Math.round(Math.min(Math.max(x, +s.min), +s.max));
  s.value = camX;
}

// ------------------------------------------------------------------ side panel

function buildStates() {
  const box = $("states");
  box.innerHTML = "";
  for (const [id, obj] of esc.objects) {
    const an = obj.anim;
    if (!an || an.isSprite) continue;
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<span title="${id}">${id}</span>`;
    const sel = document.createElement("select");
    for (const a of ["default", ...an.names()]) sel.add(new Option(a, a));
    sel.value = obj.state;
    sel.onchange = () => obj.setState(sel.value);
    sel.dataset.id = id;
    row.append(sel);
    box.append(row);
  }
  if (!box.children.length) box.textContent = "(none)";
}

function refreshStates() {
  for (const sel of $("states").querySelectorAll("select")) {
    const o = esc.objects.get(sel.dataset.id);
    if (o && document.activeElement !== sel && sel.value !== o.state) sel.value = o.state;
  }
}

function buildEvents() {
  const sel = $("evobj");
  sel.innerHTML = "";
  const all = [esc.roomObject, ...esc.objects.values()].filter((o) => o && o.events.size);
  for (const o of all) sel.add(new Option(o.globalId, o.globalId));
  sel.onchange = showEvents;
  showEvents();
}

function showEvents() {
  const id = $("evobj").value;
  const o = id === esc.roomObject?.globalId ? esc.roomObject : esc.objects.get(id);
  const box = $("evlist");
  box.innerHTML = "";
  if (!o) return;
  for (const [key, ev] of o.events) {
    const b = document.createElement("button");
    b.textContent = ":" + key;
    b.onclick = () => esc.runObjectEvent(id, ev.name, ev.target || "");
    box.append(b);
  }
}

// ------------------------------------------------------------------ drawing

let last = 0;
function frame(t) {
  const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
  last = t;
  // the pause menu pauses the game (escoria.set_game_paused)
  if (!menus.open) {
    gameUI.update(dt);
    if ($("anim").checked) esc.update(dt);
    else esc.events.tick(0);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (menus.open) {
    // pause_game(): the room and the UI are hidden while the menu is shown
    menus.draw(ctx, mouse);
  } else if (esc.view) {
    if (follow && esc.player && esc.player.movable && esc.player.movable.walking) followPlayer();
    ctx.imageSmoothingEnabled = canvas.style.imageRendering !== "pixelated";
    const cam = [1, 0, 0, 1, -camX, -camY];
    esc.camera = cam;
    // the room; its CanvasLayers above the game UI's (layer 1) after the UI
    const items = collect(esc.shownView.room, cam) /* the previous room until the new one's :setup ends */;
    draw(ctx, game, items.filter((it) => it.layer <= 1));
    overlays(cam);
    gameUI.drawSpeech(ctx, cam);
    gameUI.draw(ctx, mouse);
    draw(ctx, game, items.filter((it) => it.layer > 1));
    draw(ctx, game, collect(esc.screenRoot)); // spawn()ed scenes
    drawPopup(ctx); // an open OptionButton list
    status(cam, items);
    esc.frameDrawn();
    refreshStates();
    watchPlayer();
  }
  const ev = esc.events.runningEvent();
  const am = esc.actions;
  $("mode").textContent = `input ${esc.inputMode} · state ${esc.state}${gameUI.visible ? "" : " · UI hidden"} · ${ev ? "running :" + ev.name : "no events"} · action ${am.currentAction || "-"} (${am.state})`;
  requestAnimationFrame(frame);
}

function roomHeight() {
  const lim = esc.view.limits[0];
  return lim ? Math.min(lim.h, canvas.height) : canvas.height;
}

function poly(cam, xf, pts, stroke, fill) {
  const m = multiply(cam, xf);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const q = apply(m, p);
    i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
  });
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function label(text, p, color) {
  ctx.font = "16px system-ui, sans-serif";
  const w = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(p.x - w / 2 - 3, p.y - 18, w + 6, 20);
  ctx.fillStyle = color;
  ctx.fillText(text, p.x - w / 2, p.y - 3);
}

function overlays(cam) {
  const room = esc.view.room;
  if ($("path").checked) {
    for (const o of esc.objects.values()) {
      const m = o.movable;
      if (!m || !m.walking || m.path.length < 2) continue;
      ctx.strokeStyle = "rgba(255,80,80,0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      const pts = [m.position, ...m.path.slice(m.ofs + 1)].map((p) => apply(cam, p));
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      for (const p of pts.slice(1)) ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
    }
  }
  for (const n of room.walk()) {
    if ($("nav").checked && n.type === "NavigationRegion2D" && n.props.navigation_polygon) {
      const np = n.props.navigation_polygon.props;
      const verts = points(np.vertices);
      for (const p of np.polygons || []) poly(cam, globalTransform(n), list(p).map((i) => verts[i]), "rgba(80,255,120,0.9)", "rgba(80,255,120,0.15)");
    }
    if ($("col").checked && isItem(n)) {
      for (const s of itemShapes(n)) poly(cam, s.xf, s.pts, n.props.is_exit ? "rgba(80,160,255,0.9)" : "rgba(255,220,60,0.9)");
    }
    if ($("loc").checked && /esc_(location|interaction_location|dialog_location)/.test(n.scriptName)) {
      const p = apply(multiply(cam, globalTransform(n)), { x: 0, y: 0 });
      const c = { esc_location: "#f6f", esc_interaction_location: "#4ef", esc_dialog_location: "#fa4" }[n.scriptName];
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x + 8, p.y); ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x, p.y + 8);
      ctx.stroke();
      if (n.props.global_id) label(n.props.global_id, { x: p.x, y: p.y - 10 }, c);
    }
  }
  if ($("names").checked) {
    for (const o of esc.objects.values()) {
      const n = o.node;
      if (!isItem(n) || !o.active) continue;
      const shapes = itemShapes(n);
      let p = o.position;
      if (shapes.length) {
        const pts = shapes[0].pts.map((q) => apply(shapes[0].xf, q));
        p = { x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: Math.min(...pts.map((q) => q.y)) };
      }
      label(n.props.tooltip_name || o.globalId, apply(cam, p), o.interactive ? "#fff" : "#999");
    }
  }
}

// warns once each time the player ends up somewhere it shouldn't
let lastBad = false;
function watchPlayer() {
  const m = esc.player && esc.player.movable;
  if (!m || !esc.terrain) return;
  const p = m.position;
  let why = "";
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) why = "invalid position (NaN)";
  else if (m.walking) {
    const c = esc.terrain.nav.closest(p);
    const d = Math.hypot(c.p.x - p.x, c.p.y - p.y);
    if (d > 2) why = `outside the walkable area by ${d.toFixed(1)} px`;
  }
  if (why && !lastBad) log(`${why}! pos ${fmt(p)} · path ${m.path.map(fmt).join(" → ")}`, "warn");
  lastBad = !!why;
}

// ------------------------------------------------------------------ mouse
// As in the player: scripts' _input, the scenes' Controls, _unhandled_input,
// then the game UI; a click whose press was taken doesn't reach the game.

function roomPoint(e) {
  const s = screenPoint(e);
  return { x: s.x + camX, y: s.y + camY };
}
const GODOT_BUTTON = [1, 3, 2];
const mouseEvent = (p, button, pressed, double = false) => ({ kind: "mouse_button", x: p.x, y: p.y, button: GODOT_BUTTON[button] ?? 1, pressed, double });
const keyEvent = (e, pressed) => ({ kind: "key", key: e.key, repeat: e.repeat, pressed, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey });
let swallowed = false;
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
ui.injectInput = (raw) => {
  if (!esc || !esc.view) return;
  if (raw.kind === "key") {
    if (!esc.input(raw)) esc.unhandledInput(raw);
    return;
  }
  if (raw.kind !== "mouse_button") return esc.input(raw);
  const p = { x: raw.x, y: raw.y }, button = [0, 0, 2, 1][raw.button] ?? 0;
  if (!raw.pressed) return release(p, button);
  swallowed = press(p, button, raw.double);
  if (!swallowed) click({ __point: p }, button, !!raw.double);
};

canvas.addEventListener("mousedown", (e) => {
  if (menus.open && e.button === 0) return menus.pointerDown(screenPoint(e), e.button);
  swallowed = false;
  if (esc && esc.view) swallowed = press(screenPoint(e), e.button, e.detail === 2);
});
window.addEventListener("mouseup", (e) => {
  if (menus) menus.pointerUp(screenPoint(e), e.button);
  if (esc && esc.view && !(menus && menus.open)) release(screenPoint(e), e.button);
});
canvas.addEventListener("wheel", (e) => {
  if (menus && menus.open) {
    e.preventDefault();
    menus.wheel(e.deltaY, screenPoint(e));
  } else if (esc && esc.view && esc.controls.wheel(screenPoint(e), e.deltaY)) e.preventDefault();
}, { passive: false });
// Esc (ui_cancel): the pause menu; keys go to the menu while it is open
window.addEventListener("keydown", (e) => {
  if (!menus || !esc.view || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
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
  if (!menus || !esc || !esc.view || menus.open || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  const raw = keyEvent(e, false);
  if (!esc.input(raw)) esc.unhandledInput(raw);
});
canvas.addEventListener("mousemove", (e) => {
  mouse = screenPoint(e);
  if (menus && menus.open) return menus.pointerMove(mouse);
  if (gameUI && esc.view) {
    esc.input({ kind: "mouse_motion", x: mouse.x, y: mouse.y });
    if (esc.controls.move(mouse)) gameUI.pointerMove(null, null);
    else gameUI.pointerMove(mouse, roomPoint(e));
    canvas.style.cursor = esc.controls.cursor || "";
  }
});
canvas.addEventListener("mouseleave", () => {
  mouse = null;
  if (gameUI) gameUI.pointerMove(null, null);
});

// click: feeds scumm_wait_click, skips speech (unless input is NONE), then
// the game UI: verbs panel or the room (9-verbs game.gd)
function screenPoint(e) {
  if (e.__point) return e.__point;
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
}

function click(e, button, doubleClick) {
  e.preventDefault?.();
  if (menus.open || swallowed) return; // menus use mousedown
  if (clickWaiters.length) {
    const w = clickWaiters;
    clickWaiters = [];
    w.forEach((f) => f());
    return;
  }
  if (esc.controls.hit(screenPoint(e))) return; // Controls take mousedown / mouseup
  if (gameUI.chooser) {
    gameUI.clickChooser(screenPoint(e));
    return;
  }
  if (gameUI.speech) {
    if (esc.inputMode !== "NONE") gameUI.endSpeech();
    return;
  }
  const s = screenPoint(e);
  if (gameUI.clickPanel(s.x, s.y, button)) return;
  if (!$("walk").checked || !esc.player) return;
  const p = roomPoint(e);
  const m = esc.player.movable;
  const before = m && m.walking;
  gameUI.clickRoom(p, button, doubleClick);
  if (m && m.walking && m.path.length) {
    log(`${doubleClick ? "double click" : button === 2 ? "right click" : "click"} ${fmt(p)} · path ${m.path.map(fmt).join(" → ")}`);
    m.onArrived = () => log(`  arrived at ${fmt(m.position)} · anim ${m.sprite?.state.animation}${m.mirrored ? " (mirrored)" : ""} · z ${esc.player.node.props.z_index}`);
  } else if (!before) log(`${button === 2 ? "right click" : "click"} ${fmt(p)}`);
  follow = true;
}
canvas.addEventListener("click", (e) => click(e, 0, false));
canvas.addEventListener("dblclick", (e) => click(e, 0, true));
canvas.addEventListener("contextmenu", (e) => click(e, 2, false));

function inside(p, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function status(cam, items) {
  if (!mouse) {
    $("status").textContent = "";
    return;
  }
  const w = apply(invert(cam), mouse);
  let hit = null;
  for (const o of esc.objects.values()) {
    const n = o.node;
    if (!isItem(n) || !o.interactive || !o.active) continue;
    if (!itemShapes(n).some((s) => inside(w, s.pts.map((q) => apply(s.xf, q))))) continue;
    if (!hit || (n.props.z_index || 0) >= (hit.node.props.z_index || 0)) hit = o;
  }
  let spr = null;
  for (const it of items) {
    const fr = spriteFrame(game, it.node);
    if (!fr) continue;
    const r = spriteRect(it.node, fr);
    const l = apply(invert(it.xf), mouse);
    if (l.x >= r.x && l.y >= r.y && l.x < r.x + r.w && l.y < r.y + r.h) spr = it;
  }
  $("status").innerHTML =
    `x <b>${Math.round(w.x)}</b> y <b>${Math.round(w.y)}</b>` +
    (hit ? ` · object <b>${hit.node.props.tooltip_name || ""}</b> (${hit.globalId}, state ${hit.state})` : "") +
    (spr ? ` · sprite <b>${spr.node.pathFrom(esc.view.room)}</b> z ${spr.z}` : "");
}

start().catch((e) => {
  $("error").textContent = e.stack || String(e);
  console.error(e);
});
