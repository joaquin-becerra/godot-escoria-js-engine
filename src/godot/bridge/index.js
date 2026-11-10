// The bridge: Godot's and Escoria's GDScript API over the JS engine, for code
// translated by tools/gd2js. createBridge(esc) gives the `gd` namespace the
// translated modules use; SUPPORTED() lists what it covers (the translator
// compares a script's needs with it and reports what is missing).
import * as values from "./values.js";
import { Vector2, Color, Rect2, op, call, iter, truthy, GLOBALS, BUILTIN_METHODS, str } from "./values.js";
import { GdObject, GdNode, Signal, Callable, CLASSES, baseClass, newNode, isType, nodeApi, ATTACH, initArgs, wrapperOf } from "./nodes.js";
import { InputEventKey, InputEventMouseButton, InputEventMouseMotion } from "./input.js";
import { setCustomDraw } from "../render.js";
import { makeEscoriaClasses, ESCORIA_CLASS_NAMES, ESCORIA_SCRIPTS } from "./escoria_classes.js";
import { GdResource, GdImage, RESOURCE_CLASSES, makeFiles } from "./resources.js";
import { gdObject } from "./object.js";
import { INPUT_CLASSES, loadInputMap } from "./input.js";
import { Vector3 } from "./values.js";
import { instantiate as instantiateScene } from "../scene.js";

const RC = { RC_OK: 0, RC_ERROR: 1, RC_CANCEL: 2, RC_INTERRUPTED: 3, RC_WONT_QUEUE: 4 };
const GAME_STATE = { DEFAULT: 0, DIALOG: 1, WAIT: 2, LOADING: 3 };
const STATE_NAMES = ["DEFAULT", "DIALOG", "WAIT", "LOADING"];
const INPUT = { INPUT_ALL: 0, INPUT_NONE: 1, INPUT_SKIP: 2 };
const INPUT_NAMES = ["ALL", "NONE", "SKIP"];
const TYPE_NAMES = { 1: "bool", 2: "int", 3: "float", 4: "string", 21: "string", 22: "string" };

// SayCommand -> "say", AcceptInputCommand -> "accept_input"
const commandName = (cls) => cls.replace(/Command$/, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

export function createBridge(esc) {
  const game = esc.game;
  const bridge = { esc, game };
  GdNode.defaultBridge = bridge;
  GdResource.bridge = bridge;
  loadInputMap(game.settings);
  GLOBALS.load = (p) => bridge.load(p);
  const wrap = (n) => GdNode.wrap(n, bridge);

  // ---------------------------------------------------------------- tree, timers, scripts
  const tree = new GdObject();
  tree.create_timer = (sec) => {
    const t = new GdObject();
    esc.wait(sec).then(() => t.signal("timeout").emit());
    Object.defineProperty(t, "timeout", { get: () => t.signal("timeout") });
    return t;
  };
  Object.defineProperty(tree, "process_frame", { get: () => tree.signal("process_frame") });
  Object.defineProperty(tree, "physics_frame", { get: () => tree.signal("process_frame") });
  Object.defineProperty(tree, "paused", { get: () => false, set: () => {} });
  Object.defineProperty(tree, "current_scene", { get: () => currentScene() });
  tree.quit = () => esc.quit();
  tree.get_nodes_in_group = (g) => [...treeNodes()].filter((n) => n.groups.includes(g)).map(wrap);
  tree.call_group = (g, m, ...a) => tree.get_nodes_in_group(g).forEach((n) => typeof n[m] === "function" && n[m](...a));
  Object.defineProperty(tree, "node_added", { get: () => tree.signal("node_added") });
  Object.defineProperty(tree, "node_removed", { get: () => tree.signal("node_removed") });
  // /root: the screen root (autoloads, what spawn() and escoria.add_child() add),
  // and as its children too, like Godot's main scene: the game UI's scene and the room
  const rootWrapper = () => {
    const w = wrap(esc.screenRoot);
    if (!w.__isRoot) {
      w.__isRoot = true;
      const own = w.get_children.bind(w);
      // ...and the inventory's items (the inventory keeps them in the UI)
      const items = () => [...esc.inventoryObjects.values()].filter((o) => o && o.node).map((o) => o.node);
      w.get_children = () => [...own(), ...[esc.uiScene, esc.view && esc.view.room, ...items()].filter(Boolean).map(wrap)];
      w.get_child_count = () => w.get_children().length;
      w.get_child = (i) => w.get_children().at(i) ?? null;
    }
    return w;
  };
  Object.defineProperty(tree, "root", { get: rootWrapper });
  tree.get_root = rootWrapper;
  tree.create_tween = () => wrap(esc.screenRoot).create_tween();
  tree.get_frame = () => frames;
  bridge.tree = tree;
  const W = game.setting("display/window/size/viewport_width", 1152), H = game.setting("display/window/size/viewport_height", 648);
  const viewport = new GdObject();
  viewport.size = new Vector2(W, H);
  viewport.set_input_as_handled = () => (bridge.inputHandled = true);
  viewport.is_input_handled = () => !!bridge.inputHandled;
  // the last frame drawn (the frontend's canvas): get_texture().get_image()
  viewport.get_texture = () => gdObject({
    get_image: () => GdImage.fromPicture(esc.ui.captureScreen ? esc.ui.captureScreen(W, H) : null),
    get_width: () => W,
    get_height: () => H,
  });
  viewport.get_visible_rect = () => new Rect2(0, 0, W, H);
  viewport.get_mouse_position = () => (bridge.mouse ? new Vector2(bridge.mouse.x, bridge.mouse.y) : new Vector2());
  bridge.viewport = viewport;
  bridge.timers = new Set();
  const scripts = new Set(); // instances with _process
  const inputScripts = new Set(); // instances with _input / _unhandled_input...
  // the trees in the game: the screen root (autoloads, spawned scenes) and the room
  const treeRoots = () => [esc.screenRoot, ...(esc.view ? [esc.view.room] : [])];
  function* treeNodes() {
    for (const r of treeRoots()) yield* r.walk();
  }
  bridge.inTree = (node) => {
    let n = node;
    while (n.parent) n = n.parent;
    return treeRoots().includes(n);
  };
  /** A script instance enters the tree: @onready vars, _ready() (once), then it processes. */
  bridge.nodeAdded = (n) => {
    if (n.__node && n.__node.state && typeof n._draw === "function") n.__node.state.customDraw = true;
    n.__enterTree?.();
    if (typeof n._ready === "function" && !n.__readyDone) {
      n.__readyDone = true;
      n.__onready?.();
      n._ready();
    } else if (!n.__readyDone) {
      n.__readyDone = true;
      n.__onready?.();
    }
    if (typeof n._process === "function") scripts.add(n);
    if (["_input", "_unhandled_input", "_unhandled_key_input", "_shortcut_input"].some((m) => typeof n[m] === "function")) inputScripts.add(n);
    n.signal?.("ready").emit();
  };
  /** An engine subtree entered the tree: node_added for each node, then _ready from the leaves up. */
  bridge.enterTree = (root) => {
    const added = tree.signal("node_added");
    if (added.slots.length) for (const n of root.walk()) added.emit(wrap(n));
    const post = (n) => {
      for (const c of [...n.children]) post(c);
      const w = wrapperOf(n);
      if (w) bridge.nodeAdded(w);
    };
    post(root);
  };
  // a room's nodes enter the tree when it is shown (node_added; their scripts' _ready comes from attachScripts)
  esc.hooks.treeEntered = (root) => {
    const added = tree.signal("node_added");
    if (added.slots.length) for (const n of root.walk()) added.emit(wrap(n));
  };
  bridge.tweens = new Set();
  bridge.players = new Set(); // AudioStreamPlayers playing (volume changes)
  esc.tickers.push((dt) => {
    for (const t of [...bridge.timers]) t.__tick(dt);
    for (const t of [...bridge.tweens]) t.__tick(dt);
    tree.signal("process_frame").emit();
    for (const s of [...scripts]) {
      if (s.__freed) scripts.delete(s);
      else if (s.is_processing()) s._process(dt);
    }
  });

  /**
   * A translated script attached to a room node (esc.nodeScripts): the
   * instance replaces the node's wrapper; @onready vars, then _ready().
   */
  bridge.attachScript = (Cls, node) => {
    const inst = new Cls(ATTACH, node);
    return { ready: () => bridge.nodeAdded(inst), dispose: () => (scripts.delete(inst), inputScripts.delete(inst)) };
  };
  /** An autoload: its node goes first under the screen root (like /root/<name>), then it enters the tree. */
  bridge.addAutoload = (name, Cls) => {
    const inst = new Cls();
    inst.__node.name = name;
    const root = esc.screenRoot;
    const at = root.children.filter((c) => c.state.autoload).length;
    inst.__node.parent = root;
    inst.__node.state.autoload = true;
    root.children.splice(at, 0, inst.__node);
    bridge.autoloads[name] = inst;
    bridge.enterTree(inst.__node);
    return inst;
  };

  // ---------------------------------------------------------------- input
  // Godot's order: _input on every node (the last in the tree first), then the
  // GUI (the frontends' controls and UI), then _unhandled_input. The engine's
  // raw events: {kind: "key", key, repeat, pressed, shift, ctrl, alt, meta} or
  // {kind: "mouse_button" / "mouse_motion", x, y, button, pressed, double}.
  const toEvent = (raw) => {
    if (raw.__event) return raw.__event;
    if (raw.kind === "key") return InputEventKey.fromKey({ key: raw.key, repeat: raw.repeat, shiftKey: raw.shift, ctrlKey: raw.ctrl, altKey: raw.alt, metaKey: raw.meta }, raw.pressed);
    const p = { x: raw.x ?? 0, y: raw.y ?? 0 };
    const ev = raw.kind === "mouse_motion" ? InputEventMouseMotion.fromMouse(p, bridge.lastMouse) : InputEventMouseButton.fromMouse(p, raw.button ?? 1, !!raw.pressed, !!raw.double);
    if (raw.gx !== undefined) ev.global_position = new Vector2(raw.gx, raw.gy);
    return ev;
  };
  const inputOrder = () => {
    const order = [];
    for (const n of treeNodes()) {
      const w = wrapperOf(n);
      if (w && inputScripts.has(w) && !w.__freed && w.__input !== false) order.push(w);
    }
    return order.reverse();
  };
  const dispatch = (raw, methods) => {
    const ev = toEvent(raw);
    if (raw.kind !== "key") bridge.mouse = { x: raw.x, y: raw.y };
    bridge.inputHandled = false;
    for (const w of inputOrder()) {
      for (const m of methods) {
        if (m === "_unhandled_key_input" && raw.kind !== "key") continue;
        if (typeof w[m] === "function") {
          w[m](ev);
          if (bridge.inputHandled) return true;
        }
      }
    }
    if (raw.kind !== "key") bridge.lastMouse = { x: raw.x, y: raw.y };
    return false;
  };
  esc.hooks.input = (raw) => dispatch(raw, ["_input"]);
  esc.hooks.unhandledInput = (raw) => dispatch(raw, ["_shortcut_input", "_unhandled_key_input", "_unhandled_input"]);

  // ---------------------------------------------------------------- drawing, frames
  let frames = 0;
  setCustomDraw((ctx, node, xf) => {
    const w = wrapperOf(node);
    if (!w) return;
    bridge.drawCtx = ctx;
    bridge.drawBase = xf;
    try {
      if (typeof w._draw === "function") w._draw();
      w.signal("draw").emit();
    } finally {
      bridge.drawCtx = null;
    }
  });
  const renderingServer = new GdObject();
  Object.defineProperty(renderingServer, "frame_post_draw", { get: () => renderingServer.signal("frame_post_draw") });
  Object.defineProperty(renderingServer, "frame_pre_draw", { get: () => renderingServer.signal("frame_pre_draw") });
  renderingServer.set_default_clear_color = () => {};
  esc.hooks.frameDrawn = () => {
    frames++;
    renderingServer.signal("frame_post_draw").emit();
  };
  // the scene's [connection]s, and the engine's control signals (pressed...)
  esc.hooks.sceneConnections = (list) => {
    for (const c of list) {
      let f = new Callable(wrap(c.to), c.method);
      if (c.binds) f = f.bind(...[].concat(c.binds));
      wrap(c.from).connect(c.signal, f, c.flags);
    }
  };
  esc.hooks.scriptOf = (node) => wrap(node);
  esc.hooks.nodeSignal = (node, name, args) => {
    // an OptionButton's list opens: the signal is its PopupMenu's
    if (name === "about_to_popup") return wrap(node).get_popup().emit_signal(name);
    const w = wrap(node);
    if (name === "gui_input") {
      // the engine's raw event -> InputEvent, in the control's coordinates; also the script's _gui_input
      const raw = args[0];
      const ev = toEvent(raw);
      ev.position = new Vector2(raw.x, raw.y);
      bridge.mouse = { x: raw.gx, y: raw.gy };
      if (typeof w._gui_input === "function") w._gui_input(ev);
      return w.emit_signal("gui_input", ev);
    }
    w.emit_signal(name, ...args);
  };

  // ---------------------------------------------------------------- resources, files, audio buses
  const files = makeFiles(bridge);
  /** load(path) / preload(path): the resource (a PackedScene, a Texture2D...), or null if it isn't exported. */
  bridge.load = (path) => {
    path = String(path);
    if (!files.exists(path)) {
      esc.log(`load(): ${path} doesn't exist`, "warn");
      return null;
    }
    // pictures and fonts are fetched now (drawn once they arrive)
    if (/\.(png|jpe?g|webp|svg)$/i.test(path)) game.loadImagesIn?.({ $res: path });
    else if (/\.(fnt|ttf|otf|woff2?)$/i.test(path) || (/\.tres$/.test(path) && /Font/.test(game.files[path]?.type || ""))) game.loadFont?.(path);
    return GdResource.wrap({ $res: path }, bridge);
  };
  /** An instance of an exported scene, with its translated scripts (ready when added to the tree). */
  bridge.instantiate = (path) => {
    const node = instantiateScene(game, path);
    game.loadImagesIn && [...node.walk()].forEach((n) => game.loadImagesIn(n.props));
    // the scripts are attached now; their _ready comes when the node enters the tree
    const handles = esc.attachScripts ? esc.attachScripts(node, { ready: false }) : [];
    (esc.spawnScripts ||= []).push(...handles);
    return wrap(node);
  };
  const muted = new Set();
  bridge.mutedBus = (bus) => muted.has(0) || muted.has(BUSES.indexOf(bus));
  const BUSES = ["Master", "Music", "SFX", "Speech", "Ambient"];
  const applyMute = () => {
    esc.muted = muted.has(0);
    esc.applyVolumes();
    for (const p of bridge.players) p.__volume();
  };
  // a theme resource's value for a control type ({type: "Theme", props: {"Button/colors/font_color": ...}})
  bridge.themeValue = (theme, kind, type, name) => {
    const th = fromRes(theme);
    if (!th) return undefined;
    const p = th.props || {};
    const v = p[`${type}/${kind}/${name}`];
    if (v !== undefined) return v;
    // the theme's defaults stand for every font / font size the type doesn't set
    if (kind === "fonts" && p.default_font) return p.default_font;
    if (kind === "font_sizes" && p.default_font_size) return p.default_font_size;
    return undefined;
  };
  const fromRes = (r) => (r && r.$res ? (() => { try { return game.resource(r.$res); } catch { return null; } })() : r);
  bridge.defaultFont = () => GdResource.wrap({ type: "Font", props: {} }, bridge);
  bridge.window = gdObject({
    get mode() { return typeof document !== "undefined" && document.fullscreenElement ? 3 : 0; },
    set mode(m) { setFullscreen(m === 3 || m === 4); },
    get size() { return new Vector2(W, H); },
    get title() { return typeof document !== "undefined" ? document.title : ""; },
    set title(s) { if (typeof document !== "undefined") document.title = s; },
  });
  Object.defineProperty(bridge.window, "size_changed", { get: () => bridge.window.signal("size_changed") });
  const setFullscreen = (on) => {
    if (typeof document === "undefined") return;
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (!on && document.fullscreenElement) document.exitFullscreen?.();
  };
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("resize", () => bridge.window.signal("size_changed").emit());

  // Escoria's settings (ESCProjectSettingsManager keys) are the player's settings (esc.settings)
  const SETTING_KEYS = {
    "escoria/main/text_lang": "lang", "escoria/sound/master_volume": "master", "escoria/sound/music_volume": "music",
    "escoria/sound/sfx_volume": "sfx", "escoria/sound/speech_volume": "speech", "escoria/sound/ambient_volume": "ambient",
    "display/window/size/fullscreen": "fullscreen",
  };
  const settingsObj = () => (esc.settings ||= {});
  const getSetting = (k, def = null) => {
    const key = SETTING_KEYS[k];
    if (key) {
      const s = settingsObj();
      if (s[key] !== undefined) return s[key];
      if (key === "lang") return game.locale;
    }
    return game.setting(k, def);
  };
  const setSetting = (k, v) => {
    const key = SETTING_KEYS[k];
    if (key) settingsObj()[key] = v;
    else game.settings[k] = v;
  };
  const ESCProjectSettingsManager = {
    TEXT_LANG: "escoria/main/text_lang", VOICE_LANG: "escoria/main/voice_lang", SETTINGS_PATH: "escoria/main/settings_path",
    SAVEGAMES_PATH: "escoria/main/savegames_path", GAME_START_SCRIPT: "escoria/main/game_start_script", GAME_SCENE: "escoria/ui/game_scene",
    MASTER_VOLUME: "escoria/sound/master_volume", MUSIC_VOLUME: "escoria/sound/music_volume", SFX_VOLUME: "escoria/sound/sfx_volume",
    SPEECH_VOLUME: "escoria/sound/speech_volume", AMBIENT_VOLUME: "escoria/sound/ambient_volume", SPEECH_ENABLED: "escoria/sound/speech_enabled",
    FULLSCREEN: "display/window/size/fullscreen", WINDOW_MODE: "display/window/size/mode", DEFAULT_DIALOG_TYPE: "escoria/ui/default_dialog_type",
    get_setting: getSetting, set_setting: setSetting, has_setting: (k) => getSetting(k) !== null,
    register_setting: (k, def) => { if (getSetting(k) === null) setSetting(k, def); },
    remove_setting: () => {},
  };
  const settingsManager = {
    apply_settings() {
      const s = settingsObj();
      if (s.lang && game.locales().includes(s.lang) && s.lang !== game.locale) {
        game.locale = s.lang;
        esc.ui.languageChanged?.();
      }
      esc.applyVolumes();
      for (const p of bridge.players) p.__volume();
      esc.ui.applySettings?.(s);
    },
    save_settings() { esc.storageSet("settings", settingsObj()); },
    load_settings() { Object.assign(settingsObj(), esc.storageGet("settings") || {}); },
    get_settings: () => settingsObj(),
  };

  // ---------------------------------------------------------------- escoria
  // the reserved sound objects (_music...): Escoria's ESCMusicPlayer / ESCSoundPlayer, over the engine's SoundPlayer
  const soundNodes = new WeakMap();
  const soundNode = (p) => {
    if (!p || typeof p.setState !== "function") return p;
    if (!soundNodes.has(p)) {
      const stream = gdObject({
        get stream_paused() { return !!p.paused; },
        set stream_paused(v) { v ? (p.pause(), (p.paused = true)) : (p.resume(), (p.paused = false)); },
        get playing() { return p.playing(); },
        get_playback_position: () => p.position(),
      });
      soundNodes.set(p, gdObject({
        stream,
        get state() { return p.state; },
        set_state: (s, force = false) => p.setState(s, 0, force),
        pause: () => (stream.stream_paused = true),
        resume: () => (stream.stream_paused = false),
        get_playback_position: () => p.position(),
      }));
    }
    return soundNodes.get(p);
  };
  const objectOf = (o) => {
    if (!o) return null;
    return gdObject({
      global_id: o.globalId,
      get node() { return o.node && o.node.walk ? wrap(o.node) : soundNode(o.node); },
      get active() { return o.active; },
      set active(v) { o.active = truthy(v); },
      get interactive() { return o.interactive; },
      set interactive(v) { o.interactive = truthy(v); },
      get state() { return o.state; },
      set_state: (s, immediate = false) => o.setState(s, immediate),
      get_state: () => o.state,
      is_active: () => o.active,
    });
  };
  const currentScene = () => {
    if (!esc.view) return null;
    const r = wrap(esc.view.room);
    if (!r.__escoria) {
      r.__escoria = true;
      Object.defineProperty(r, "global_id", { get: () => esc.roomObject && esc.roomObject.globalId });
      Object.defineProperty(r, "player", { get: () => (esc.player ? wrap(esc.player.node) : null) });
      Object.defineProperty(r, "game", {
        get: () => ({
          hide_ui: () => esc.ui.setGuiVisible?.(false),
          show_ui: () => esc.ui.setGuiVisible?.(true),
          get tooltip_node() { return null; },
          // game.gd's menus (the frontend's menus: the game's own scenes or the engine's)
          pause_game: () => esc.menus?.showPause(),
          unpause_game: () => esc.menus?.close(),
          show_main_menu: () => esc.menus?.showMain(),
          hide_main_menu: () => (esc.menus?.hideMain ? esc.menus.hideMain() : esc.menus?.close()),
        }),
      });
    }
    return r;
  };
  const log = (level) => (who, msg) => esc.log(str(msg === undefined ? who : msg), level === "debug" || level === "trace" ? "info" : level);
  const escoria = {
    GameState: GAME_STATE,
    get current_state() { return GAME_STATE[esc.state] ?? 0; },
    set current_state(v) { esc.state = STATE_NAMES[v] || "DEFAULT"; },
    logger: { debug: log("debug"), trace: log("trace"), info: log("info"), warn: log("warn"), error: log("error") },
    globals_manager: {
      get_global: (k) => esc.globals.get(k),
      set_global: (k, v, ignoreReserved = false) => esc.globals.set(k, v, ignoreReserved),
      has: (k) => esc.globals.has(k),
      get_globals: () => Object.fromEntries(esc.globals.values),
      replace_globals: (s) => esc.globals.replace(s),
    },
    inventory_manager: {
      inventory_has: (id) => esc.inventory.has(id),
      add_item: (id) => esc.inventory.add(id),
      remove_item: (id) => esc.inventory.remove(id),
      items_in_inventory: () => esc.inventory.items(),
    },
    object_manager: {
      get_object: (id) => objectOf(id === esc.roomObject?.globalId ? esc.roomObject : esc.getObject(id)),
      has: (id) => esc.hasObject(id),
      CAMERA: "_camera", MUSIC: "_music", SOUND: "_sound", SPEECH: "_speech", AMBIENT: "_ambient",
    },
    main: { get current_scene() { return currentScene(); } },
    inputs_manager: {
      ...INPUT,
      get input_mode() { return INPUT[`INPUT_${esc.inputMode}`] ?? 0; },
      set input_mode(v) { esc.inputMode = INPUT_NAMES[v] || "ALL"; },
    },
    event_manager: {
      CHANNEL_FRONT: "_front",
      is_channel_free: (c) => esc.events.isChannelFree(c),
      interrupt: () => esc.events.interrupt(),
      queue_event: (ev, force = false) => { if (ev) esc.events.queue(ev); return 0; },
      interrupt_channel: (c) => esc.events.interruptChannel(c),
      get_running_event: (ch = "_front") => {
        const ev = esc.events.runningEvent?.(ch);
        if (!ev) return null;
        ev.get_event_name ??= () => ev.name;
        return ev;
      },
    },
    room_manager: { change_scene_to_file: (path) => esc.changeScene(path) },
    settings_manager: settingsManager,
    new_game: () => esc.newGame(),
    quit: () => esc.quit(),
    // escoria is a node (the autoload): what scripts add to it lives above the rooms
    add_child: (n) => {
      esc.screenRoot.add(n.__node);
      bridge.enterTree(n.__node);
    },
    remove_child: (n) => esc.screenRoot.remove(n.__node),
    get_node_or_null: (path) => { const n = esc.screenRoot.getNode(String(path)); return n ? wrap(n) : null; },
    get_node: (path) => { const n = esc.screenRoot.getNode(String(path)); return n ? wrap(n) : null; },
    get_tree: () => tree,
  };
  bridge.escoria = escoria;
  bridge.objectWrapper = objectOf;

  // ---------------------------------------------------------------- commands
  class ESCCommandArgumentDescriptor {
    constructor(min = 0, types = [], defaults = [], strip = [true], varargs = false) {
      Object.assign(this, { min_args: min, types, defaults, strip_quotes: strip, has_varargs: varargs });
    }
  }
  class ESCBaseCommand extends GdObject {
    configure() { return new ESCCommandArgumentDescriptor(); }
    validate() { return true; }
    run() { return RC.RC_OK; }
    interrupt() {}
    get_command_name() { return this.constructor.commandName || commandName(this.constructor.name); }
    raise_error(_who, msg) { esc.log(`${this.get_command_name()}: ${str(msg)}`, "error"); }
    raise_invalid_object_error(_who, id) { esc.log(`${this.get_command_name()}: object not found '${id}'`, "error"); }
  }
  /** A translated command class as an engine command (esc.addCommands). */
  bridge.commandImpl = (Cls) => {
    let inst = null;
    const desc = () => {
      inst = new Cls();
      const d = inst.configure();
      const t = (x) => (Array.isArray(x) ? x.map(t) : TYPE_NAMES[x] || "any");
      return { min: d.min_args, types: d.types.map(t), defaults: [...d.defaults], strip: d.strip_quotes, varargs: d.has_varargs };
    };
    return {
      configure: desc,
      validate: (_e, a) => (inst.validate(a) === false ? "validation failed" : null),
      async run(_e, a, cmd) {
        if (cmd) cmd.impl.interrupt = () => inst.interrupt();
        const rc = await inst.run(a);
        return typeof rc === "number" ? rc : RC.RC_OK;
      },
    };
  };
  // Escoria's own commands as classes: SayCommand.new().run([...])
  const commandClass = (cls) => {
    const name = commandName(cls);
    return class extends ESCBaseCommand {
      static commandName = name;
      run(args) {
        const impl = esc.commands.get(name);
        if (!impl || impl.missing) return esc.log(`command ${name} not available`, "error"), RC.RC_ERROR;
        return esc.runCommand({ name, args, token: { file: "(gdscript)", line: 0 }, channel: "", impl, interrupted: false });
      }
    };
  };

  // ---------------------------------------------------------------- names
  const consts = (o) => Object.freeze(o);
  const classes = {
    Vector2, Vector2i: Vector2, Vector3, Color, Rect2, Rect2i: Rect2, Signal, Callable, Object: GdObject, RefCounted: GdObject,
    ESCBaseCommand, ESCCommandArgumentDescriptor, ESCExecution: RC,
    ESCProjectSettingsManager,
    ESCObjectManager: consts({ CAMERA: "_camera", MUSIC: "_music", SOUND: "_sound", SPEECH: "_speech", AMBIENT: "_ambient", RESERVED_OBJECTS: ["_camera", "_music", "_sound", "_speech", "_ambient"] }),
    ConfigFile: files.ConfigFile, FileAccess: files.FileAccess, DirAccess: files.DirAccess,
    TextServer: consts({ AUTOWRAP_OFF: 0, AUTOWRAP_ARBITRARY: 1, AUTOWRAP_WORD: 2, AUTOWRAP_WORD_SMART: 3, OVERRUN_NO_TRIMMING: 0, OVERRUN_TRIM_CHAR: 1, OVERRUN_TRIM_WORD: 2, OVERRUN_TRIM_ELLIPSIS: 3 }),
    Tween: consts({ TRANS_LINEAR: 0, TRANS_SINE: 1, TRANS_QUINT: 2, TRANS_QUART: 3, TRANS_QUAD: 4, TRANS_EXPO: 5, TRANS_ELASTIC: 6, TRANS_CUBIC: 7, TRANS_CIRC: 8, TRANS_BOUNCE: 9, TRANS_BACK: 10, TRANS_SPRING: 11, EASE_IN: 0, EASE_OUT: 1, EASE_IN_OUT: 2, EASE_OUT_IN: 3, TWEEN_PROCESS_PHYSICS: 0, TWEEN_PROCESS_IDLE: 1, TWEEN_PAUSE_BOUND: 0, TWEEN_PAUSE_STOP: 1, TWEEN_PAUSE_PROCESS: 2 }),
    CanvasItem: consts({ TEXTURE_FILTER_PARENT_NODE: 0, TEXTURE_FILTER_NEAREST: 1, TEXTURE_FILTER_LINEAR: 2, TEXTURE_FILTER_NEAREST_WITH_MIPMAPS: 3, TEXTURE_FILTER_LINEAR_WITH_MIPMAPS: 4 }),
    ...INPUT_CLASSES,
    ...RESOURCE_CLASSES,
    ...CLASSES,
  };
  // Node / Control constants (Node.PROCESS_MODE_ALWAYS, Control.PRESET_FULL_RECT...)
  const NODE_CONSTS = { AUTO_TRANSLATE_MODE_INHERIT: 0, AUTO_TRANSLATE_MODE_ALWAYS: 1, AUTO_TRANSLATE_MODE_DISABLED: 2, PROCESS_MODE_INHERIT: 0, PROCESS_MODE_PAUSABLE: 1, PROCESS_MODE_WHEN_PAUSED: 2, PROCESS_MODE_ALWAYS: 3, PROCESS_MODE_DISABLED: 4 };
  const CONTROL_CONSTS = { PRESET_TOP_LEFT: 0, PRESET_TOP_RIGHT: 1, PRESET_BOTTOM_LEFT: 2, PRESET_BOTTOM_RIGHT: 3, PRESET_CENTER_LEFT: 4, PRESET_CENTER_TOP: 5, PRESET_CENTER_RIGHT: 6, PRESET_CENTER_BOTTOM: 7, PRESET_CENTER: 8, PRESET_LEFT_WIDE: 9, PRESET_TOP_WIDE: 10, PRESET_RIGHT_WIDE: 11, PRESET_BOTTOM_WIDE: 12, PRESET_VCENTER_WIDE: 13, PRESET_HCENTER_WIDE: 14, PRESET_FULL_RECT: 15, MOUSE_FILTER_STOP: 0, MOUSE_FILTER_PASS: 1, MOUSE_FILTER_IGNORE: 2, FOCUS_NONE: 0, FOCUS_CLICK: 1, FOCUS_ALL: 2, CURSOR_ARROW: 0, CURSOR_POINTING_HAND: 2, SIZE_FILL: 1, SIZE_EXPAND: 2, SIZE_EXPAND_FILL: 3, SIZE_SHRINK_CENTER: 4, SIZE_SHRINK_END: 8 };
  for (const [name, C] of Object.entries(CLASSES)) {
    for (const [k, v] of Object.entries(NODE_CONSTS)) if (!(k in C)) Object.defineProperty(C, k, { value: v });
    if (C.prototype instanceof GdNode && "add_theme_color_override" in C.prototype) for (const [k, v] of Object.entries(CONTROL_CONSTS)) if (!(k in C)) Object.defineProperty(C, k, { value: v });
  }
  const singletons = {
    Engine: { get time_scale() { return esc.timeScale; }, set time_scale(v) { esc.timeScale = Number(v) || 1; }, is_editor_hint: () => false, get_frames_drawn: () => 0, has_singleton: () => false, get_singleton: () => null },
    Input: {
      is_action_pressed: () => false, is_action_just_pressed: () => false, is_key_pressed: () => false, is_mouse_button_pressed: () => false,
      get_mouse_position: () => (bridge.mouse ? new Vector2(bridge.mouse.x, bridge.mouse.y) : new Vector2()),
      set_default_cursor_shape: () => {}, set_mouse_mode: () => {}, MOUSE_MODE_VISIBLE: 0, MOUSE_MODE_HIDDEN: 1,
      // the event goes through the whole input path again (the frontend's)
      parse_input_event: (ev) => {
        const raw = ev instanceof InputEventKey
          ? { kind: "key", key: ev.unicode ? String.fromCodePoint(ev.unicode) : "", pressed: ev.pressed, __event: ev }
          : { kind: ev instanceof InputEventMouseMotion ? "mouse_motion" : "mouse_button", x: ev.position.x, y: ev.position.y, button: ev.button_index, pressed: ev.pressed, double: ev.double_click, __event: ev };
        Promise.resolve().then(() => esc.ui.injectInput?.(raw));
      },
    },
    RenderingServer: renderingServer,
    OS: { get_name: () => "Web", has_feature: (f) => f === "web", get_locale_language: () => ((typeof navigator !== "undefined" && navigator.language) || "en").split("-")[0], get_locale: () => (typeof navigator !== "undefined" && navigator.language) || "en" },
    Time: { get_ticks_msec: () => Math.floor(performance.now()), get_unix_time_from_system: () => Date.now() / 1000 },
    ProjectSettings: { get_setting: (k, d = null) => getSetting(k, d), set_setting: setSetting, has_setting: (k) => getSetting(k) !== null, globalize_path: (p) => p, save: () => 0 },
    DisplayServer: {
      WINDOW_MODE_WINDOWED: 0, WINDOW_MODE_MINIMIZED: 1, WINDOW_MODE_MAXIMIZED: 2, WINDOW_MODE_FULLSCREEN: 3, WINDOW_MODE_EXCLUSIVE_FULLSCREEN: 4,
      window_get_mode: () => bridge.window.mode, window_set_mode: (m) => (bridge.window.mode = m),
      screen_get_size: () => new Vector2(typeof screen !== "undefined" ? screen.width : W, typeof screen !== "undefined" ? screen.height : H),
      window_get_size: () => new Vector2(W, H), mouse_set_mode: () => {},
    },
    AudioServer: {
      set_bus_mute: (i, on) => { on ? muted.add(i) : muted.delete(i); applyMute(); },
      is_bus_mute: (i) => muted.has(i),
      get_bus_index: (name) => BUSES.indexOf(String(name)),
      get_bus_name: (i) => BUSES[i] || "",
      get_bus_count: () => BUSES.length,
      set_bus_volume_db: () => {}, get_bus_volume_db: () => 0,
    },
    ResourceLoader: files.ResourceLoader,
    FileAccess: files.FileAccess,
    TranslationServer: {
      get_locale: () => game.locale,
      set_locale: (l) => { if (l !== game.locale) { game.locale = l; esc.ui.languageChanged?.(); } },
      translate: (k) => game.tr(k),
      get_loaded_locales: () => game.locales(),
    },
  };
  // Escoria's classes the game scripts use and extend (adapters over the engine's UI)
  const escoriaClasses = makeEscoriaClasses(bridge);
  Object.assign(classes, escoriaClasses.classes);
  Object.assign(escoria, escoriaClasses.escoria);
  Object.assign(bridge, {
    op, call, iter, truthy, str, G: GLOBALS, values,
    Vector2, Color, Callable: (o, m) => new Callable(o, m),
    base: (name) => (name === "ESCBaseCommand" ? ESCBaseCommand : name === "RefCounted" || name === "Object" ? GdObject : name === "Resource" ? GdResource : classes[name] && classes[name].prototype instanceof GdObject ? classes[name] : baseClass(name)),
    /** extends "res://x.gd": a translated script (registerScript) or one of Escoria's the bridge adapts */
    baseScript(path) {
      if (bridge.scripts[path]) return bridge.scripts[path];
      if (bridge.scriptBases[path]) return bridge.scriptBases[path];
      esc.log(`extends "${path}": neither translated nor adapted; using Node`, "warn");
      return GdNode;
    },
    scripts: {},
    registerScript(path, Cls) {
      bridge.scripts[path] = Cls;
    },
    ATTACH, initArgs, isValue: values.isValue,
    /** obj.name read as a value: a method gives a Callable bound to obj (GDScript), anything else its value */
    member(o, k) {
      if (o === null || o === undefined) throw new TypeError(`access to .${k} on null`);
      if (typeof o !== "object" && typeof o !== "function") return values.call(o, k); // "abc".length -> property of a value
      const v = o[k];
      if (typeof v === "function" && !(o instanceof Function) && !/^class /.test(Function.prototype.toString.call(v))) return new Callable(o, k);
      return v;
    },
    /** A class by name (Vector2, Timer, SayCommand...) */
    cls(name) {
      if (classes[name]) return classes[name];
      if (/Command$/.test(name)) return (classes[name] = commandClass(name));
      throw new Error(`class ${name} isn't in the bridge yet`);
    },
    /** Class.new(args) */
    new_(name, args = []) {
      if (CLASSES[name]) return newNode(name, bridge);
      const C = bridge.cls(name);
      return new C(...args);
    },
    singleton: (name) => singletons[name] || null,
    /** A class by name, or null if the bridge doesn't have it (nor a translated script registered it) */
    classOrNull: (name) => classes[name] || null,
    /** translated scripts with class_name, for the others to use */
    registerClass(name, Cls) {
      classes[name] = Cls;
    },
    autoloads: {},
    autoload: (name) => bridge.autoloads[name] || null,
    is: isType,
    preload: (path) => bridge.load(path),
    tr: (s) => game.tr(s),
  });
  return bridge;
}

// properties of Godot's classes that are kept as the node's / resource's props
const GODOT_PROPS = [
  "horizontal_alignment", "vertical_alignment", "autowrap_mode", "auto_translate_mode", "clip_text", "text_overrun_behavior", "uppercase",
  "visible_characters", "visible_ratio", "max_lines_visible", "lines_skipped", "label_settings", "fit_content", "scroll_active", "bbcode_enabled",
  "stretch_mode", "expand_mode", "flip_h", "flip_v", "texture", "texture_filter", "texture_repeat", "region_enabled", "region_rect", "centered", "offset",
  "hframes", "vframes", "frame", "frame_coords", "speed_scale", "autoplay", "sprite_frames", "animation",
  "flat", "focus_mode", "alignment", "icon", "icon_alignment", "expand_icon", "toggle_mode", "action_mode", "keep_pressed_outside", "shortcut", "tooltip_text",
  "mouse_default_cursor_shape", "mouse_filter", "size_flags_horizontal", "size_flags_vertical", "size_flags_stretch_ratio", "clip_contents",
  "anchor_left", "anchor_top", "anchor_right", "anchor_bottom", "offset_left", "offset_top", "offset_right", "offset_bottom", "pivot_offset", "grow_horizontal", "grow_vertical",
  "one_shot", "wait_time", "autostart", "loop", "loop_offset", "bus", "volume_db", "pitch_scale", "stream",
  "color", "light_mask", "visibility_layer", "top_level", "show_behind_parent", "y_sort_enabled", "use_parent_material", "material",
  "placeholder_text", "editable", "secret", "max_length", "caret_blink", "selecting_enabled",
  "bg_color", "border_color", "border_width_left", "border_width_top", "border_width_right", "border_width_bottom", "corner_radius_top_left",
  "corner_radius_top_right", "corner_radius_bottom_left", "corner_radius_bottom_right", "content_margin_left", "content_margin_top",
  "content_margin_right", "content_margin_bottom", "texture_margin_left", "texture_margin_top", "texture_margin_right", "texture_margin_bottom",
  "draw_center", "modulate_color", "font_data", "base_font", "variation_embolden", "spacing_glyph",
  "shader", "code", "render_priority", "next_pass", "blend_mode", "light_mode",
  "default_font", "default_font_size", "default_base_scale",
  // ConfigFile
  "load", "save", "get_value", "set_value", "has_section", "has_section_key", "get_sections", "get_section_keys", "erase_section", "erase_section_key",
];

/** What the bridge covers, by the groups of tools/gd2js/api_usage.js. */
export function SUPPORTED() {
  return {
    globals: new Set([...Object.keys(GLOBALS), "Callable"]),
    classes: new Set(["int", "float", "bool", "String", "StringName", "NodePath", "Array", "Dictionary", "Variant", "Vector2", "Vector2i", "Vector3", "Color", "Rect2", "Rect2i",
      "Signal", "Callable", "Object", "RefCounted", ...ESCORIA_CLASS_NAMES, ...ESCORIA_SCRIPTS.map((s) => `${s} (extends)`), "ESCBaseCommand", "ESCCommandArgumentDescriptor", "ESCExecution", "ESCProjectSettingsManager", "ESCObjectManager",
      "ConfigFile", "FileAccess", "DirAccess", "TextServer", "Tween", "CanvasItem", "Node", "Control",
      ...Object.keys(INPUT_CLASSES), ...Object.keys(RESOURCE_CLASSES), ...Object.keys(CLASSES), "*Command",
      "PROCESS_MODE_INHERIT", "PROCESS_MODE_PAUSABLE", "PROCESS_MODE_WHEN_PAUSED", "PROCESS_MODE_ALWAYS", "PROCESS_MODE_DISABLED"]),
    escoria: new Set([
      "escoria.GameState", "escoria.current_state", "escoria.logger", "escoria.globals_manager.get_global", "escoria.globals_manager.set_global",
      "escoria.globals_manager.has", "escoria.globals_manager.get_globals", "escoria.globals_manager.replace_globals",
      "escoria.inventory_manager.inventory_has", "escoria.inventory_manager.add_item", "escoria.inventory_manager.remove_item", "escoria.inventory_manager.items_in_inventory",
      "escoria.object_manager.get_object", "escoria.object_manager.has", "escoria.main.current_scene", "escoria.inputs_manager",
      "escoria.event_manager.is_channel_free", "escoria.event_manager.interrupt", "escoria.event_manager.interrupt_channel",
      "escoria.event_manager.get_running_event", "escoria.event_manager.CHANNEL_FRONT", "escoria.room_manager.change_scene_to_file", "escoria.quit",
      "escoria.settings_manager.apply_settings", "escoria.settings_manager.save_settings", "escoria.settings_manager.load_settings", "escoria.new_game",
      "escoria.add_child", "escoria.remove_child", "escoria.get_node_or_null", "escoria.get_node", "escoria.get_tree",
      "escoria.esc_compiler.load_esc_file", "escoria.event_manager.queue_event", "escoria.action_manager.current_action", "escoria.action_manager.current_tool",
      "escoria.action_manager.current_target", "escoria.action_manager.action_state", "escoria.action_manager.clear_current_action", "escoria.action_manager.clear_current_tool",
    ]),
    scripts: new Set(ESCORIA_SCRIPTS),
    singletons: new Set(["Engine", "Input", "OS", "Time", "ProjectSettings", "TranslationServer", "DisplayServer", "AudioServer", "ResourceLoader", "FileAccess", "RenderingServer"]),
    node: new Set([...nodeApi(), ...resourceApi(), ...escoriaApi()]),
    builtin: new Set([...BUILTIN_METHODS.Array, ...BUILTIN_METHODS.String, ...BUILTIN_METHODS.Dictionary,
      "run", "configure", "validate", "interrupt", "get_event_name", "get_command_name", "raise_error", "raise_invalid_object_error",
      "length", "normalized", "distance_to", "angle", "clamp", "lerp", "x", "y", "bind", "call", "connect", "emit", "disconnect", "timeout", "process_frame", "create_timer",
      "global_id", "node", "active", "interactive", "state", "set_state", "get_state", "game", "player", "hide_ui", "show_ui", "size", "position", "end",
      // the viewport, the tree, the window
      "set_input_as_handled", "is_input_handled", "get_texture", "get_visible_rect", "get_mouse_position", "call_group", "get_nodes_in_group", "root", "get_root",
      "node_added", "node_removed", "get_frame", "paused", "current_scene", "quit", "frame_post_draw", "frame_pre_draw",
      // fields and methods of value types
      "r", "g", "b", "a", "h", "s", "v", "z", "w",
      ...[Vector2, Vector3, Color, Rect2].flatMap((C) => Object.getOwnPropertyNames(C.prototype)).filter((k) => k !== "constructor" && !k.startsWith("__")),
      // properties of Godot's nodes and resources the scripts set: they go to the
      // node's props (the renderer uses the ones it knows)
      ...GODOT_PROPS]),
  };
}

// what the Escoria adapters define (fields and methods subclasses use)
function escoriaApi() {
  const names = new Set(["dialog_location_node", "_current_character", "_current_line", "_text_timing_finished", "_waiting_for_voice_audio", "_reading_speed_in_wpm", "text_node",
    "current_action", "current_target", "current_prep", "current_target2", "waiting_for_target2", "color", "dialog", "_no_more_options", "option", "options", "is_valid",
    "get_timeout_option", "timeout", "avatar", "last_dir", "last_deg", "is_mirrored", "walk_destination", "target_object", "target_position", "fast", "dont_interact_on_arrival",
    "origin", "get_global_transform_with_canvas", "get_global_transform", "events"]);
  const src = makeEscoriaClasses.toString();
  for (const m of src.matchAll(/^\s{4,6}(?:get |set )?([_a-z][_a-z0-9]*)\(/gm)) names.add(m[1]);
  return names;
}

// the methods of resources and input events (members of values of unknown type)
function resourceApi() {
  const names = new Set();
  for (const C of new Set([...Object.values(RESOURCE_CLASSES), ...Object.values(INPUT_CLASSES)])) {
    for (let p = C.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) for (const k of Object.getOwnPropertyNames(p)) if (!k.startsWith("__") && k !== "constructor") names.add(k);
  }
  // fields set in constructors (InputEvent's)
  for (const C of Object.values(INPUT_CLASSES)) for (const k of Object.keys(new C())) if (!k.startsWith("__")) names.add(k);
  for (const k of ["finished", "loop_finished", "step_finished", "from", "from_current", "as_relative", "set_delay", "set_trans", "set_ease", "tween_property", "tween_interval",
    "tween_callback", "tween_method", "parallel", "set_parallel", "chain", "set_loops", "kill", "is_running", "is_valid", "mode", "size", "size_changed", "title"]) names.add(k);
  return names;
}

export { RC, GdNode, GdObject };
