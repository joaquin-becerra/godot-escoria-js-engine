// The Escoria runtime: globals, inventory, objects, events, commands and
// rooms (what escoria-core's managers do: esc_globals_manager.gd,
// esc_inventory_manager.gd, esc_object_manager.gd, esc_room_manager.gd...).
//
// The page that shows the game (viewer, later the player) provides `ui`:
//   ui.say(item, text, {type, key}) -> Promise   speech line
//   ui.chooseDialogOption(dialog) -> Promise<option>
//   ui.setGuiVisible(bool), ui.setTooltipVisible(bool)
//   ui.waitClick() -> Promise                    next click
import { compile, eventKey } from "./ashes/compiler.js";
import { RC, str } from "./ashes/interpreter.js";
import { EventManager, CHANNEL_FRONT, EV } from "./events.js";
import { loadRoom, isItem } from "./room.js";
import { instantiate, Node as SceneNode } from "../godot/scene.js";
import { ControlInput } from "../godot/control_input.js";
import { findTerrain } from "./terrain.js";
import { Movable } from "./movable.js";
import { AnimPlayer, advancePlayer } from "../godot/animation_player.js";
import { advanceSprite } from "../godot/animation.js";
import { advanceParticles } from "../godot/particles.js";
import { globalTransform, apply } from "../godot/render.js";
import { vec2 } from "../godot/values.js";
import { CORE_COMMANDS } from "./commands/core.js";
import { ActionManager } from "./actions.js";
import { SoundPlayer, SOUND_CHANNELS } from "./audio.js";
import { TransitionPlayer } from "./transitions.js";
import { shapesOverlap } from "./ui/game_ui.js";
import { EscCamera } from "./camera.js";

export { RC, CHANNEL_FRONT, EV };

const GLOBAL_LAST_SCENE = "ESC_LAST_SCENE";
const GLOBAL_CURRENT_SCENE = "ESC_CURRENT_SCENE";
const GLOBAL_FORCE_LAST_SCENE_NULL = "FORCE_LAST_SCENE_NULL";
const GLOBAL_ANIMATION_RESOURCES = "ANIMATION_RESOURCES";

// ---------------------------------------------------------------- globals

class Globals {
  constructor(esc) {
    this.esc = esc;
    this.values = new Map();
    this.reserved = new Set();
  }
  has(k) {
    return this.values.has(k);
  }
  get(k) {
    return this.values.has(k) ? this.values.get(k) : null;
  }
  set(k, v, ignoreReserved = false) {
    if (this.reserved.has(k) && !ignoreReserved) this.esc.log(`Global key ${k} is reserved and can not be overridden.`, "error");
    const old = this.get(k);
    this.values.set(k, v);
    if (old !== v) this.esc.log(`  global ${k} = ${JSON.stringify(v)}`, "global");
  }
  reserve(k, v) {
    this.reserved.add(k);
    this.values.set(k, v);
  }
  /** "{name}" inside a text -> the global's value */
  replace(text) {
    return text.replace(/\{([^}]*)\}/g, (_, k) => str(this.get(k)));
  }
}

class Inventory {
  constructor(esc) {
    this.esc = esc;
  }
  has(id) {
    return this.esc.globals.has(`i/${id}`) && !!this.esc.globals.get(`i/${id}`);
  }
  add(id) {
    this.esc.globals.set(`i/${id}`, true);
  }
  remove(id) {
    if (!this.has(id)) return this.esc.log(`Error removing inventory item: Trying to remove non-existent item ${id}.`, "error");
    this.esc.globals.set(`i/${id}`, false);
  }
  items() {
    return [...this.esc.globals.values].filter(([k, v]) => k.startsWith("i/") && v).map(([k]) => k.slice(2));
  }
}

// ---------------------------------------------------------------- objects

/** ESCObject: an item / location / player known by its global id. */
export class EscObject {
  constructor(esc, globalId, node) {
    this.esc = esc;
    this.globalId = globalId;
    this.node = node;
    this.state = "default";
    this.events = new Map();
    this.movable = null;
    this._anim = undefined;
  }

  get active() {
    return this.node.props.visible !== false;
  }
  set active(v) {
    this.node.props.visible = !!v;
  }

  get interactive() {
    return this.node.props.is_interactive !== false;
  }
  set interactive(v) {
    this.node.props.is_interactive = !!v;
  }

  /** get_animation_player(): animation_player_node, or the last AnimatedSprite2D / AnimationPlayer child */
  get anim() {
    if (this._anim === undefined) {
      let n = null;
      const path = this.node.props.animation_player_node;
      if (path && path.args && path.args[0]) n = this.node.getNode(path.args[0]);
      else for (const c of this.node.children) if (c.type === "AnimatedSprite2D" || c.type === "AnimationPlayer") n = c;
      this._anim = n ? new AnimPlayer(n) : null;
    }
    return this._anim;
  }

  /** ESCObject.set_state(): plays the animation with the state's name, if any. */
  setState(state, immediate = false) {
    this.state = state;
    const a = this.anim;
    if (!a) return;
    a.stop();
    if (a.has(state)) immediate ? a.seekEnd(state) : a.play(state);
  }

  /** get_interact_position() */
  interactPosition() {
    let interact = null, location = null, other = null;
    for (const c of this.node.children) {
      if (c.type !== "Marker2D") continue;
      const p = apply(globalTransform(c), { x: 0, y: 0 });
      if (c.scriptName === "esc_location") location = p;
      else if (c.scriptName === "esc_interaction_location") interact = p;
      else other = p;
    }
    if (interact) return interact;
    if (location) return location;
    if (other) return other;
    const col = this.node.children.find((c) => c.type === "CollisionShape2D" || c.type === "CollisionPolygon2D");
    return apply(globalTransform(col || this.node), { x: 0, y: 0 });
  }

  get position() {
    return apply(globalTransform(this.node), { x: 0, y: 0 });
  }
}

// ---------------------------------------------------------------- runtime

export class Escoria {
  constructor(game, { log = console.log, ui = {} } = {}) {
    this.game = game;
    this.logFn = log;
    this.ui = ui;
    this.globals = new Globals(this);
    this.inventory = new Inventory(this);
    this.events = new EventManager(this);
    this.objects = new Map();
    this.inventoryObjects = new Map(); // id -> EscObject of items/inventory/<id>.tscn
    this.roomStates = new Map(); // room id -> Map(global id -> {state, active, interactive})
    this.view = null; // {room, player, limits}
    this.terrain = null;
    this.roomObject = null;
    this.player = null;
    this.inputMode = "ALL";
    this.state = "DEFAULT"; // escoria.current_state: DEFAULT, DIALOG, WAIT...
    this.saveEnabled = true; // save_manager.save_enabled (events with NO_SAVE turn it off)
    this.loading = false;
    this.timers = [];
    this.tickers = []; // game-specific per-frame updates (roaming...)
    this.keyHandlers = []; // (KeyboardEvent) => true if used (ports: F10...)
    this.nodeScripts = {}; // .gd path -> (esc, node) => {update?(dt), dispose?()}: scripts of room nodes
    this.roomScripts = []; // the ones running in the current room
    this.timeScale = 1; // Engine.time_scale
    this.screenRoot = new SceneNode("root", "Node"); // what spawn() adds (Godot's /root)
    this.camera = [1, 0, 0, 1, 0, 0]; // room -> screen, the frontend sets it each frame
    // Controls of the spawned scenes (all) and of the room (the interactive ones)
    this.controls = new ControlInput(
      // an open menu of the game's (ui/scene_menus.js) is modal
      () => (this.menuRoot ? [{ root: this.menuRoot, base: [1, 0, 0, 1, 0, 0] }] : [{ root: this.screenRoot, base: [1, 0, 0, 1, 0, 0] }, { root: this.view && this.view.room, base: this.camera, onlyInteractive: true }]),
      (n, s, a) => this.emitNodeSignal(n, s, ...a),
    );
    this.muted = false;
    this.hooks = {}; // ports: their patches to Escoria (ports.js), the UI's (ui/game_ui.js)
    this.scriptCache = new Map();
    this.commands = this.loadCommands(CORE_COMMANDS);
    // commands that only set state (a room opened on its own runs them from
    // the start script's :init); ports add theirs
    this.stateCommands = new Set(["inventory_add", "inventory_remove", "set_global", "set_globals", "inc_global", "dec_global"]); // () => void when a saved game loads / a new game starts (game_is_loading)
    this.actions = new ActionManager(this);
    this.transitions = new TransitionPlayer(this); // main.scene_transition
    // the room's ESCCamera (_camera); `camera` above is its transform
    this.cameraPlayer = new EscCamera(this, game.setting("display/window/size/viewport_width", 1152), game.setting("display/window/size/viewport_height", 648));
    // reserved objects _music, _sound, _speech, _ambient (ESCObjectManager.RESERVED_OBJECTS)
    this.sounds = {};
    for (const id of SOUND_CHANNELS) {
      const player = new SoundPlayer(this, id);
      this.sounds[id] = player;
      this.reserved = this.reserved || new Map();
      // set_state(_music, "off"): ESCObject.set_state() -> the player's set_state()
      this.reserved.set(id, { globalId: id, node: player, events: new Map(), get state() { return player.state; }, setState: (st) => player.setState(st) });
    }
    for (const [k, v] of [[GLOBAL_LAST_SCENE, ""], [GLOBAL_FORCE_LAST_SCENE_NULL, false], [GLOBAL_ANIMATION_RESOURCES, {}], [GLOBAL_CURRENT_SCENE, ""]]) this.globals.reserve(k, v);
  }

  /** A key pressed in the page; true if a port used it. */
  key(e) {
    return this.keyHandlers.some((h) => h(e));
  }

  log(msg, level = "info") {
    this.logFn(msg, level);
  }

  /**
   * ESC commands: one per .gd file in the command directories (setting
   * escoria/main/command_directories), implemented by `impls` (keyed by
   * command name, or by the .gd path for game-specific ones).
   */
  loadCommands(impls) {
    const dirs = this.game.setting("escoria/main/command_directories", ["res://addons/escoria-core/game/core-scripts/esc/commands"]);
    const out = new Map();
    for (const dir of dirs) {
      const prefix = dir.replace(/\/?$/, "/");
      for (const gd of this.game.json.gdscripts || []) {
        if (!gd.startsWith(prefix) || gd.slice(prefix.length).includes("/")) continue;
        const name = gd.slice(prefix.length, -3);
        const impl = impls[gd] || impls[name];
        out.set(name, impl ? { ...impl, name, isCommand: true } : { name, isCommand: true, missing: gd });
      }
    }
    return out;
  }

  /** Ports: implementations of the game's own commands, by .gd path or command name. */
  addCommands(impls) {
    // by the command's name or by its .gd (also once a port gave it an implementation)
    for (const [name, c] of this.commands) {
      const source = c.missing || c.source;
      const impl = (source && impls[source]) || impls[name];
      if (impl) this.commands.set(name, { ...impl, name, source, isCommand: true });
    }
  }

  /** ESCCommand.run(): prepare and validate the arguments, then run. */
  async runCommand(cmd) {
    const impl = cmd.impl;
    const where = `${cmd.token.file}:${cmd.token.line}`;
    if (impl.missing) {
      this.log(`command ${cmd.name} not ported to JS (${impl.missing}) in ${where}`, "error");
      return RC.ERROR;
    }
    const desc = impl.configure ? impl.configure() : { min: 0, types: [] };
    const args = prepareArguments(desc, cmd.args);
    const err = validateArguments(desc, args) || (impl.validate ? impl.validate(this, args) : null);
    if (err) {
      this.log(`${cmd.name}: ${err} (${where})`, "error");
      return RC.ERROR;
    }
    this.log(`  ${cmd.name}(${args.map((a) => JSON.stringify(a)).join(", ")})`, "command");
    try {
      return (await impl.run(this, args, cmd)) ?? RC.OK;
    } catch (e) {
      this.log(`${cmd.name}: error de JS: ${e.stack || e}`, "error");
      return RC.ERROR;
    }
  }

  chooseDialogOption(dialog) {
    if (!this.ui.chooseDialogOption) {
      this.log("no dialog option chooser", "error");
      return Promise.resolve(null);
    }
    return this.ui.chooseDialogOption(dialog);
  }

  /** A promise that resolves after `seconds` of game time (stops early if `cmd` is interrupted). */
  wait(seconds, cmd = null) {
    return new Promise((ok) => this.timers.push({ left: seconds, ok, cmd }));
  }

  // ---------------------------------------------------------------- scripts

  compileScript(file, objectGlobalId = "") {
    const key = `${file}|${objectGlobalId}`;
    if (!this.scriptCache.has(key)) {
      const src = this.game.scripts[file];
      if (src === undefined) {
        this.log(`script ${file} wasn't exported`, "error");
        this.scriptCache.set(key, { events: new Map(), errors: [] });
      } else {
        const s = compile(src, file, objectGlobalId);
        for (const e of s.errors) this.log(e, "error");
        this.scriptCache.set(key, s);
      }
    }
    return this.scriptCache.get(key);
  }

  /** Queues `event` (with optional target) of a compiled script. Returns the event or null. */
  queueEvent(script, name, target = "", { force = false, channel = CHANNEL_FRONT } = {}) {
    const ev = script.events.get(eventKey(name, target)) || null;
    if (!ev) return null;
    if (channel === CHANNEL_FRONT) this.events.queue(ev, force);
    else this.events.queueBackground(channel, ev);
    return ev;
  }

  /** Runs an event of the game start script (escoria/main/game_start_script). */
  async runStartEvent(name) {
    const file = this.game.setting("escoria/main/game_start_script", "");
    const ev = this.queueEvent(this.compileScript(file), name, "", { force: true });
    if (!ev) return this.log(`${file} has no :${name}`, "error");
    return this.events.waitFinished(name);
  }

  /**
   * Runs only the game-state part of an event (to open a room on its own as
   * if the game had started): its `global` declarations and the calls that
   * just set state (inventory, globals), not room changes or screen effects.
   */
  async runStateOf(file, name) {
    const ev = this.compileScript(file).events.get(name);
    if (!ev) return;
    const STATE_COMMANDS = this.stateCommands;
    const { Interpreter } = await import("./ashes/interpreter.js");
    const it = new Interpreter(this);
    it.currentEvent = ev;
    for (const s of ev.body.statements) {
      const call = s.kind === "Expression" && s.expr.kind === "Call" && s.expr.callee.kind === "Variable" ? s.expr.callee.name.lexeme : null;
      if (s.kind === "Global" || (call && STATE_COMMANDS.has(call))) await it.execute(s);
    }
  }

  // ---------------------------------------------------------------- objects

  // esc_object_manager.gd has(); a game that patched it answers through
  // esc.hooks.objectManagerHas(id) (true / false, or undefined: Escoria's answer)
  hasObject(id) {
    if (this.objects.has(id) || this.reserved.has(id)) return true;
    return !!this.hooks.objectManagerHas?.(id);
  }

  getObject(id) {
    return this.objects.get(id) || this.reserved.get(id) || (this.inventory.has(id) ? this.inventoryObject(id) : null);
  }

  /** Volumes changed (options): the sounds playing now follow. */
  applyVolumes() {
    for (const p of Object.values(this.sounds)) p.applyVolume();
  }

  /**
   * The object of an inventory item (inventory_ui.gd add_new_item_by_id):
   * its scene in escoria/ui/inventory_items_path, registered once.
   */
  inventoryObject(id) {
    if (!this.inventoryObjects.has(id)) {
      const dir = String(this.game.setting("escoria/ui/inventory_items_path", "")).replace(/\/$/, "");
      const file = `${dir}/${id}.tscn`;
      if (!this.game.files[file]) {
        this.log(`inventory item '${id}' has no scene (${file})`, "error");
        this.inventoryObjects.set(id, null);
      } else {
        const node = instantiate(this.game, file);
        const obj = new EscObject(this, id, node);
        if (node.props.esc_script) obj.events = this.compileScript(node.props.esc_script, id).events;
        this.inventoryObjects.set(id, obj);
        this.game.loadImagesIn(node.props);
        // in Godot the inventory adds the item to the UI: it enters the tree (node_added)
        this.hooks.treeEntered?.(node);
      }
    }
    return this.inventoryObjects.get(id);
  }

  registerRoomObjects(room) {
    const roomId = room.props.global_id || room.name;
    const saved = this.roomStates.get(roomId) || new Map();
    for (const n of room.walk()) {
      const script = n.scriptName;
      if (!["esc_item", "esc_player", "esc_location"].includes(script) && !(isItem(n))) continue;
      const id = n.props.global_id;
      if (!id) continue;
      const obj = new EscObject(this, id, n);
      if (n.props.esc_script) obj.events = this.compileScript(n.props.esc_script, id).events;
      if (script === "esc_exit") this.setupExit(obj);
      if (isItem(n)) {
        if (n.props.is_movable) obj.movable = new Movable(n, this.terrain);
        // ESCItem._ready(): the state starts as the current animation
        const prev = saved.get(id);
        if (prev) {
          obj.setState(prev.state);
          obj.active = prev.active;
          obj.interactive = prev.interactive;
          if (prev.tooltip !== undefined) n.props.tooltip_name = prev.tooltip;
          // saved games: where movable items were and where they faced
          if (prev.position && obj.movable) {
            obj.movable.teleportTo(prev.position);
            if (prev.lastDir !== undefined) obj.movable.setDirection(prev.lastDir);
          }
        } else if (obj.anim) obj.state = obj.anim.current() || "default";
      }
      this.objects.set(id, obj);
      if (n === this.view.player) this.player = obj;
    }
  }

  /**
   * ESCExit: is_exit (_enter_tree), and when its script has no :exit_scene,
   * one that plays switch_sound and changes to target_scene (_register_event).
   */
  setupExit(obj) {
    const props = obj.node.props;
    props.is_exit = true;
    if (obj.events.has(eventKey(EV.EXIT_SCENE, ""))) return;
    const res = (v) => (v && typeof v === "object" ? v.$res : v) || "";
    const q = (v) => JSON.stringify(String(v));
    const sound = res(props.switch_sound);
    const src = `:${EV.EXIT_SCENE}\n` + (sound ? `\tplay_snd(${q(sound)})\n` : "") + `\tchange_scene(${q(res(props.target_scene))})\n`;
    const s = compile(src, "ESCExit", obj.globalId);
    for (const e of s.errors) this.log(e, "error");
    obj.events = new Map([...obj.events, ...s.events]);
  }

  // ---------------------------------------------------------------- triggers

  /**
   * ESCItem is_trigger: the Area2D's body / area entered and exited, for the
   * movable items (their collision shapes); ESCActionManager TRIGGER_IN /
   * TRIGGER_OUT queue `trigger_in_verb` / `trigger_out_verb` (with the other
   * object as target, else without one) if the trigger is active and interactive.
   */
  updateTriggers() {
    if (this.events.changingScene || this.loading) return;
    const movers = [...this.objects.values()].filter((o) => o.movable && o.active);
    for (const t of this.objects.values()) {
      const p = t.node.props;
      if (!p.is_trigger) continue;
      t.inside ||= new Set();
      for (const m of movers) {
        if (m === t) continue;
        const now = shapesOverlap(t.node, m.node);
        if (now === t.inside.has(m.globalId)) continue;
        if (now) t.inside.add(m.globalId);
        else t.inside.delete(m.globalId);
        if (!t.active || !t.interactive) continue;
        const verb = now ? p.trigger_in_verb || "trigger_in" : p.trigger_out_verb || "trigger_out";
        const ev = t.events.get(eventKey(verb, m.globalId)) || t.events.get(eventKey(verb, ""));
        if (ev) this.events.queue(ev);
      }
    }
  }

  // ---------------------------------------------------------------- hover

  /**
   * ESCItem mouse_entered / mouse_exited: _apply_hover_behavior() and
   * _apply_unhover_behavior() (hover_enabled: hover_modulate, and on a
   * Sprite2D hover_texture / hover_shader).
   */
  setHovered(obj) {
    if (obj === this.hoveredItem) return;
    const prev = this.hoveredItem;
    this.hoveredItem = obj;
    if (prev && prev.hoverSaved) {
      const { sprite, modulate, texture, material } = prev.hoverSaved;
      sprite.props.modulate = modulate;
      if (texture !== undefined) sprite.props.texture = texture;
      if (material !== undefined) sprite.props.material = material;
      prev.hoverSaved = null;
    }
    if (!obj || !obj.node.props.hover_enabled) return;
    const props = obj.node.props;
    const sprite = obj.node.children.find((c) => c.type === "Sprite2D" || c.type === "AnimatedSprite2D");
    if (!sprite) return;
    const saved = { sprite, modulate: sprite.props.modulate };
    sprite.props.modulate = props.hover_modulate || { type: "Color", args: [1, 1, 1, 1] };
    if (sprite.type === "Sprite2D") {
      if (props.hover_texture) {
        saved.texture = sprite.props.texture;
        sprite.props.texture = props.hover_texture;
      }
      if (props.hover_shader) {
        saved.material = sprite.props.material;
        sprite.props.material = props.hover_shader;
      }
    }
    obj.hoverSaved = saved;
  }

  // ---------------------------------------------------------------- slide

  /**
   * slide / slide_block: moves `obj` to `dest`'s position in a straight line
   * at `speed` px/s (-1: the item's speed), without walking animations.
   * Resolves when it gets there or is stopped (another slide of it, interrupt).
   */
  slide(obj, dest, speed = -1) {
    if (speed === -1) speed = obj.node.props.speed ?? 300;
    this.slides ||= new Map();
    this.slides.get(obj.globalId)?.done();
    const from = obj.position, to = dest.position;
    const time = speed > 0 ? Math.hypot(to.x - from.x, to.y - from.y) / speed : 0;
    return new Promise((ok) => {
      const sl = { obj, from, to, t: 0, time, done: () => (this.slides.get(obj.globalId) === sl && this.slides.delete(obj.globalId), ok()) };
      this.slides.set(obj.globalId, sl);
    });
  }

  stopSlides() {
    for (const sl of [...(this.slides || new Map()).values()]) sl.done();
  }

  updateSlides(dt) {
    if (!this.slides) return;
    for (const sl of [...this.slides.values()]) {
      sl.t += dt;
      const k = sl.time > 0 ? Math.min(sl.t / sl.time, 1) : 1;
      this.setGlobalPosition(sl.obj, { x: sl.from.x + (sl.to.x - sl.from.x) * k, y: sl.from.y + (sl.to.y - sl.from.y) * k });
      if (k >= 1) sl.done();
    }
  }

  /** global_position = p (the parent's offset kept). */
  setGlobalPosition(obj, p) {
    if (obj.movable) {
      obj.movable.teleportTo(p);
      return;
    }
    const g = obj.position, l = vec2(obj.node.props.position);
    obj.node.props.position = { type: "Vector2", args: [p.x - g.x + l.x, p.y - g.y + l.y] };
  }

  /** Remembers the objects of the current room (ESCObject.get_save_data()). */
  saveRoomStates(withPositions = false) {
    if (!this.roomObject) return;
    const m = new Map();
    for (const [id, o] of this.objects) {
      const s = { state: o.state, active: o.active, interactive: o.interactive, tooltip: o.node.props.tooltip_name };
      if (withPositions && o.movable) {
        s.position = o.movable.position;
        s.lastDir = o.movable.lastDir;
      }
      m.set(id, s);
    }
    this.roomStates.set(this.roomObject.globalId, m);
  }

  // ---------------------------------------------------------------- saved games

  /** Browser storage for this game's saves and settings. */
  get storagePrefix() {
    return `escoria-js:${this.game.base.replace(/\/$/, "").split("/").pop()}:`;
  }

  storageGet(key) {
    try {
      const v = localStorage.getItem(this.storagePrefix + key);
      return v === null ? null : JSON.parse(v);
    } catch {
      return null;
    }
  }

  storageSet(key, value) {
    try {
      if (value === null) localStorage.removeItem(this.storagePrefix + key);
      else localStorage.setItem(this.storagePrefix + key, JSON.stringify(value));
      return true;
    } catch (e) {
      this.log(`couldn't save in the browser: ${e.message}`, "error");
      return false;
    }
  }

  /** {slot: {name, date}} of the saved games (get_saves_list()). */
  listSaves() {
    const out = {};
    for (let slot = 1; slot <= 99; slot++) {
      const s = this.storageGet(`save_${String(slot).padStart(3, "0")}`);
      if (s) out[slot] = { name: s.name, date: s.date };
    }
    return out;
  }

  /** save_game(): globals, inventory, objects of every room visited, the room. */
  saveGame(slot, name) {
    if (!this.saveEnabled) return this.log("saving is disabled now", "warn"), false;
    this.saveRoomStates(true);
    const data = {
      format: 1,
      name,
      date: new Date().toISOString(),
      gameVersion: this.game.setting("escoria/main/game_version", ""),
      room: this.view && this.view.room.sceneFile,
      globals: [...this.globals.values],
      rooms: [...this.roomStates].map(([room, m]) => [room, [...m]]),
      sounds: Object.fromEntries(Object.entries(this.sounds).map(([id, p]) => [id, { state: p.state, position: p.position() }])),
      terrain: this.terrain && this.terrain.active ? this.terrain.active.name : null, // terrain_navpolys
      scheduled: this.events.scheduled.map((s) => ({ event: s.event.name, object: s.event.objectGlobalId, file: s.event.token?.file, timeout: s.timeout })),
    };
    const ok = this.storageSet(`save_${String(slot).padStart(3, "0")}`, data);
    if (ok) this.log(`game saved in slot ${slot}: ${name}`, "event");
    return ok;
  }

  /** load_game(): change to the saved room without :setup / :ready, then restore everything. */
  async loadGame(slot) {
    const data = this.storageGet(`save_${String(slot).padStart(3, "0")}`);
    if (!data) return this.log(`no saved game in slot ${slot}`, "error");
    this.log(`loading saved game ${slot}: ${data.name}`, "event");
    this.loading = true;
    this.state = "LOADING";
    this.events.interrupt();
    this.timers.forEach((t) => t.ok());
    this.timers = [];
    this.ui.gameLoading?.();
    this.globals.values = new Map(data.globals);
    this.roomStates = new Map(data.rooms.map(([room, objs]) => [room, new Map(objs)]));
    this.roomObject = null; // so changeScene doesn't overwrite the loaded states
    await this.changeScene(data.room, { loading: true });
    if (data.terrain && this.terrain && this.terrain.active?.name !== data.terrain) this.terrain.enable(data.terrain);
    for (const p of Object.values(this.sounds)) p.setState("off");
    // music and sounds resume where they were (save_sounds_playback_position)
    for (const [id, s] of Object.entries(data.sounds || {})) {
      if (this.sounds[id] && (this.sounds[id].conf.loop || id === "_music")) this.sounds[id].setState(s.state, s.position || 0, true);
    }
    for (const s of data.scheduled || []) {
      const o = this.getObject(s.object) || (this.roomObject && this.roomObject.globalId === s.object ? this.roomObject : null);
      const ev = o && o.events.get(s.event);
      if (ev) this.events.schedule(ev, s.timeout);
    }
    this.actions.clearCurrentAction();
    this.inputMode = "ALL";
    this.state = "DEFAULT";
    this.loading = false;
    this.ui.gameLoaded?.();
  }

  /**
   * escoria.quit(): Godot closes the game window. In the browser the game
   * stops (no events, no input, no updates) and the page decides what to show.
   */
  quit() {
    if (this.ended) return;
    this.ended = true;
    for (const p of Object.values(this.sounds)) p.setState("off");
    this.log("end of the game (escoria.quit)", "event");
    this.events.interrupt();
    this.inputMode = "NONE";
    this.ui.quit?.();
  }

  /** escoria.new_game(): reset the game state and run :newgame of the start script. */
  async newGame() {
    this.events.interrupt();
    this.timers.forEach((t) => t.ok());
    this.timers = [];
    const reserved = [...this.globals.reserved].map((k) => [k, this.globals.values.get(k)]);
    this.globals.values = new Map(reserved);
    this.roomStates = new Map();
    this.roomObject = null;
    for (const p of Object.values(this.sounds)) p.setState("off");
    this.actions.clearCurrentAction();
    this.inputMode = "ALL";
    this.state = "DEFAULT";
    this.ui.gameLoading?.();
    return this.runStartEvent("newgame");
  }

  // ---------------------------------------------------------------- rooms

  /**
   * change_scene_to_file() + ESCRoomManager._perform_script_events() without
   * the transitions: load the room, register its objects, :setup, then :ready.
   */
  /** The room that is seen: the previous one while the new one runs :setup (main.gd). */
  get shownView() {
    return this.previousView || this.view;
  }

  async changeScene(file, { loading = false } = {}) {
    this.inputMode = "NONE";
    this.events.setChangingScene(true);
    if (this.globals.get(GLOBAL_FORCE_LAST_SCENE_NULL)) this.globals.set(GLOBAL_LAST_SCENE, null, true);
    else if (this.roomObject) this.globals.set(GLOBAL_LAST_SCENE, this.roomObject.globalId, true);
    this.saveRoomStates();

    for (const s of this.roomScripts) s.dispose?.();
    this.roomScripts = [];
    this.stopSlides();
    // main.gd set_scene(): the new room comes in hidden; the previous one is
    // still what is seen until set_scene_finish(), after :setup (a transition
    // captures it then: scumm_fade_out)
    this.previousView = this.previousView || this.view;
    this.view = await loadRoom(this.game, file);
    const room = this.view.room;
    this.terrain = findTerrain(this.game, room);
    this.objects = new Map();
    this.player = null;
    this.hoveredItem = null;
    this.registerRoomObjects(room);
    // esc_room_manager: the player's animations from set_animations
    // (ANIMATION_RESOURCES) carry over to the new room's player
    const anims = this.player && (this.globals.get(GLOBAL_ANIMATION_RESOURCES) || {})[this.player.globalId];
    if (anims && this.game.files[anims]) {
      const res = this.game.resource(anims);
      this.player.node.props.animations = res;
      if (this.player.movable) {
        this.player.movable.anims = res.props;
        this.player.movable.setDirection(this.player.movable.lastDir ?? 0); // update_idle()
      }
    }
    const roomId = room.props.global_id || room.name;
    this.roomObject = new EscObject(this, roomId, room);
    const script = room.props.esc_script ? this.compileScript(room.props.esc_script) : { events: new Map() };
    this.roomObject.events = script.events;
    this.log(`room ${roomId} (${file})`, "event");
    this.roomScripts.push(...this.attachScripts(room));
    // init_room(): a new camera with the room's first limits
    this.cameraPlayer.reset();
    if (this.view.limits.length) this.cameraPlayer.setLimits(0);

    if (!loading && this.queueEvent(script, EV.SETUP, "", { force: true })) {
      const rc = await this.events.waitFinished(EV.SETUP);
      if (rc !== RC.OK) {
        this.previousView = null;
        this.ui.roomChanged?.(this.view);
        return rc;
      }
    }
    this.events.setChangingScene(false);
    if (this.player) this.cameraPlayer.setTarget(this.player);
    this.cameraPlayer.center = null; // make_current(): the first frame looks at its target
    this.previousView = null; // set_scene_finish(): the new room is seen
    this.hooks.menusClosed?.(); // game_scene.hide_main_menu() / unpause_game()
    this.ui.roomChanged?.(this.view);
    this.globals.set(GLOBAL_CURRENT_SCENE, roomId, true);
    // :transition_in (the automatic transition itself comes later)
    this.events.queue({ kind: "Event", name: EV.TRANSITION_IN, target: null, flags: {}, flagBits: 0, objectGlobalId: "", body: { kind: "Block", statements: [] } });
    this.inputMode = "ALL";
    if (!loading && this.queueEvent(script, EV.READY)) {
      const rc = await this.events.waitFinished(EV.READY);
      if (rc !== RC.OK) return rc;
    }
    if (this.globals.get(GLOBAL_FORCE_LAST_SCENE_NULL)) {
      this.globals.set(GLOBAL_FORCE_LAST_SCENE_NULL, false, true);
      this.globals.set(GLOBAL_LAST_SCENE, roomId, true);
    }
    return RC.OK;
  }

  /**
   * The ported scripts of a tree's nodes (esc.nodeScripts), as Godot does on
   * instancing: every script first, then the scene's signal connections, then
   * _ready (children before parents). Returns the handles ({update, dispose}).
   */
  attachScripts(root, { ready = true } = {}) {
    const handles = [];
    for (const n of root.walk()) {
      const f = n.script && this.nodeScripts[n.script];
      if (f) handles.push(f(this, n) || {});
      else if (n.script && !n.script.startsWith("res://addons/") && !this.portHandles?.has(n.script) && !this.warnedScripts?.has(n.script)) {
        (this.warnedScripts ||= new Set()).add(n.script);
        this.log(`script ${n.script} (node ${n.name}) not ported to JS`, "warn");
      }
    }
    for (const n of root.walk()) if (n.connections && n.connections.length) this.hooks.sceneConnections?.(n.connections);
    if (ready) {
      this.hooks.treeEntered?.(root);
      for (const h of [...handles].reverse()) h.ready?.();
    }
    return handles;
  }

  /**
   * Input for the game's scripts (raw events, see the GDScript bridge):
   * input() before the UI (_input), unhandledInput() when the UI didn't use it.
   * True if a script took it (set_input_as_handled).
   */
  input(raw) {
    return !!this.hooks.input?.(raw);
  }
  unhandledInput(raw) {
    return !!this.hooks.unhandledInput?.(raw);
  }
  /** The frontend drew a frame (RenderingServer.frame_post_draw). */
  frameDrawn() {
    this.hooks.frameDrawn?.();
  }

  /** A node of the scene emitted a signal (a Button "pressed"...): the scripts' bridge hears it. */
  emitNodeSignal(node, name, ...args) {
    this.hooks.nodeSignal?.(node, name, args);
  }

  /** spawn(): a scene added to the root (screen space, above the room, under the UI), kept across rooms. */
  async spawn(id, file, active = true, at = null) {
    const node = instantiate(this.game, file);
    for (const n of node.walk()) await this.game.loadImagesIn(n.props);
    if (at) node.props.position = { type: "Vector2", args: [at.x, at.y] };
    this.screenRoot.add(node);
    const obj = new EscObject(this, id, node);
    if (node.props.esc_script) obj.events = this.compileScript(node.props.esc_script, id).events;
    this.objects.set(id, obj);
    obj.active = active;
    this.spawnScripts = (this.spawnScripts || []).concat(this.attachScripts(node));
    return obj;
  }

  /** Runs `event` of an object (as the action manager will do after walking). */
  runObjectEvent(id, name, target = "") {
    const obj = id === this.roomObject?.globalId ? this.roomObject : this.getObject(id);
    if (!obj) return this.log(`no object ${id}`, "error"), null;
    const ev = obj.events.get(eventKey(name, target));
    if (!ev) return this.log(`${id} has no :${name}${target ? " " + target : ""}`, "warn"), null;
    this.events.queue(ev);
    return ev;
  }

  // ---------------------------------------------------------------- frame

  update(dt) {
    if (this.ended) return;
    dt *= this.timeScale;
    for (const s of this.roomScripts) s.update?.(dt);
    this.controls.update(dt);
    this.transitions.update(dt);
    this.cameraPlayer.update(dt);
    this.updateSlides(dt);
    this.events.tick(dt);
    for (const t of [...this.timers]) {
      t.left -= dt;
      if (t.left <= 0 || (t.cmd && t.cmd.interrupted)) {
        this.timers.splice(this.timers.indexOf(t), 1);
        t.ok();
      }
    }
    for (const f of this.tickers) f(dt);
    if (!this.view) return;
    for (const o of this.objects.values()) if (o.movable) o.movable.update(dt);
    this.updateTriggers();
    for (const tree of [this.view.room, this.screenRoot]) {
      for (const n of tree.walk()) {
        if (n.type === "AnimatedSprite2D") advanceSprite(n, dt);
        else if (n.type === "AnimationPlayer") advancePlayer(n, dt);
        else if (n.type === "GPUParticles2D") advanceParticles(n, dt);
      }
    }
  }
}

// ---------------------------------------------------------------- arguments

// ESCCommandArgumentDescriptor: {min, types, defaults, strip = [true], varargs}
// types: "string" | "int" | "float" | "bool" | "any", or an array of them
function prepareArguments(desc, args) {
  const out = [...(desc.defaults || [])];
  const strip = desc.strip || [true];
  const varargs = [];
  for (let i = 0; i < args.length; i++) {
    if (i >= out.length) {
      if (desc.varargs) varargs.push(args[i]);
      else out.push(args[i]);
    } else if (i === out.length - 1 && desc.varargs) varargs.push(args[i]);
    else {
      out[i] = args[i];
      const s = strip.length === out.length ? strip[i] : strip[0];
      if (s && typeof out[i] === "string") out[i] = out[i].replaceAll('"', "");
    }
  }
  if (desc.varargs) out[out.length - 1] = varargs;
  return out;
}

function isType(v, type) {
  switch (type) {
    case "string": return typeof v === "string";
    case "bool": return typeof v === "boolean";
    case "float": return typeof v === "number";
    case "int": return typeof v === "number" && Number.isInteger(v);
    case "any": return true;
  }
  return false;
}

function validateArguments(desc, args) {
  const types = desc.types || [];
  let required = 0;
  for (let i = 0; i < desc.min; i++) if (args[i] !== null && args[i] !== undefined) required++;
  if (required < desc.min) return `missing arguments: expected ${desc.min}, got ${required}`;
  if (args.length > types.length && !desc.varargs) return `too many arguments (at most ${types.length}): ${JSON.stringify(args)}`;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === null || args[i] === undefined) continue;
    if (desc.varargs && i === args.length - 1) continue;
    let t = types[Math.min(i, types.length - 1)];
    if (!Array.isArray(t)) t = [t];
    if (!t.some((x) => isType(args[i], x))) return `argument ${i} (${JSON.stringify(args[i])}) is not ${t.join(" or ")}`;
  }
  return null;
}
