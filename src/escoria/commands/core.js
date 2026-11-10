// Escoria's ESC commands (escoria-core/game/core-scripts/esc/commands/*.gd),
// ported to JS. Escoria, MIT license, (c) Godot Escoria contributors.
//
// Each command: configure() -> {min, types, defaults, strip, varargs};
// validate(esc, args) -> error text or null; async run(esc, args, cmd) -> RC.
// Not ported yet: the engine reports "not ported" when a script uses them.
import { RC } from "../ashes/interpreter.js";
import { TRANSITION_TYPES } from "../camera.js";

const desc = (min, types, defaults, strip = [true], varargs = false) => ({ min, types, defaults, strip, varargs });
const mustExist = (i = 0) => (esc, a) => (esc.hasObject(a[i]) ? null : `object not found '${a[i]}'`);
const item = (esc, id) => esc.getObject(id);
// ESCCameraBaseCommand.generate_viewport_warning()
const viewportWarning = (name, p, cam) => {
  const l = cam.limits;
  return `[${name}]: Invalid camera position. Camera cannot be moved to (${Math.floor(p.x)}, ${Math.floor(p.y)}) as this is outside the viewport with current camera limit (${l.left}, ${l.top}, ${l.right - l.left}, ${l.bottom - l.top}). Valid: x = [${l.left + cam.W / 2}, ${l.right - cam.W / 2}]; y = [${l.top + cam.H / 2}, ${l.bottom - cam.H / 2}].`;
};

// --- talking (esc_item.gd start_talking / stop_talking)
export function startTalking(obj) {
  const m = obj.movable, anims = m && m.anims;
  if (!anims || !(anims.speaks || []).length || !obj.anim) return;
  obj.anim.stop();
  const dir = m.lastDir;
  const speak = anims.speaks[dir];
  if (speak.props.mirrored && !m.mirrored && m.sprite) flipSprite(m.sprite);
  obj.anim.play(speak.props.animation);
}

export function stopTalking(obj) {
  const m = obj.movable, anims = m && m.anims;
  if (!anims || !(anims.speaks || []).length || !obj.anim) return;
  obj.anim.stop();
  const dir = m.lastDir;
  if (anims.speaks[dir].props.mirrored && !m.mirrored && m.sprite) {
    const s = m.sprite.props.scale;
    if (s && s.args[0] < 1) flipSprite(m.sprite);
  }
  obj.anim.play(anims.idles[dir].props.animation);
}

function flipSprite(sprite) {
  const s = sprite.props.scale ? sprite.props.scale.args : [1, 1];
  sprite.props.scale = { type: "Vector2", args: [-s[0], s[1]] };
}

// action_manager.do(BACKGROUND_CLICK, [id, target(pos or id), fast]): walk an item
function walkItem(esc, id, target, fast) {
  const t = typeof target === "string" ? item(esc, target) : target;
  esc.actions.performWalk(item(esc, id), t, fast);
}

export const CORE_COMMANDS = {
  accept_input: {
    configure: () => desc(1, ["string"], ["ALL"]),
    validate: (esc, a) => (["ALL", "NONE", "SKIP"].includes(a[0]) ? null : `invalid mode ${a[0]}`),
    run(esc, a) {
      esc.inputMode = a[0];
    },
  },

  anim: {
    configure: () => desc(2, ["string", "string", "bool"], [null, null, false]),
    validate: mustExist(),
    run(esc, a) {
      const an = item(esc, a[0]).anim;
      if (an) an.play(a[1], a[2]);
    },
  },

  anim_block: {
    configure: () => desc(2, ["string", "string", "bool"], [null, null, false]),
    validate: mustExist(),
    async run(esc, a) {
      const an = item(esc, a[0]).anim;
      if (!an) return;
      an.play(a[1], a[2]);
      await an.finished();
    },
  },

  // block_say / end_block_say: dialog_player.enable_preserve_dialog_box(); the
  // engine's floating speech has no box to keep between lines (only the flag)
  block_say: {
    configure: () => desc(0, [], []),
    run(esc) {
      esc.preserveDialogBox = true;
    },
  },

  // --- camera (ESCCamera: src/escoria/camera.js)
  camera_push: {
    configure: () => desc(1, ["string", "float", "string"], [null, 1, "QUAD"]),
    validate(esc, a) {
      if (!esc.hasObject(a[0])) return `object not found '${a[0]}'`;
      const cam = esc.cameraPlayer;
      const p = cam.resolve(item(esc, a[0])).pos;
      if (!cam.insideViewportLimits(p)) return viewportWarning("camera_push", p, cam);
      if (!TRANSITION_TYPES.includes(a[2])) return `Transition type ${a[2]} is not one of the accepted types: ${TRANSITION_TYPES}`;
      return null;
    },
    run(esc, a) {
      esc.cameraPlayer.push(item(esc, a[0]), a[1], a[2]);
    },
  },

  camera_set_limits: {
    configure: () => desc(1, ["int"], [null]),
    validate: (esc, a) => (esc.cameraPlayer.limitCount < a[0] ? `Camera limit ${a[0]} requested, the room has ${esc.cameraPlayer.limitCount}.` : null),
    run(esc, a) {
      esc.cameraPlayer.clampToViewportLimits();
      esc.cameraPlayer.setLimits(a[0]);
    },
  },

  camera_set_pos: {
    configure: () => desc(3, ["float", "int", "int"], [null, null, null]),
    validate(esc, a) {
      const p = { x: a[1], y: a[2] };
      return esc.cameraPlayer.insideViewportLimits(p) ? null : viewportWarning("camera_set_pos", p, esc.cameraPlayer);
    },
    run(esc, a) {
      esc.cameraPlayer.setTarget({ x: a[1], y: a[2] }, a[0]);
    },
  },

  camera_set_target: {
    configure: () => desc(2, ["float", "string"], [null, null]),
    validate: mustExist(1),
    run(esc, a) {
      esc.cameraPlayer.setTarget(item(esc, a[1]), a[0]);
    },
  },

  camera_set_target_block: {
    configure: () => desc(2, ["float", "string"], [null, null]),
    validate: mustExist(1),
    async run(esc, a) {
      esc.cameraPlayer.setTarget(item(esc, a[1]), a[0]);
      if (a[0] > 0) await esc.cameraPlayer.tweenFinished();
    },
  },

  camera_set_zoom: {
    configure: () => desc(1, ["float", "float"], [null, 0.0]),
    run(esc, a) {
      esc.cameraPlayer.setZoom(a[0], a[1]);
    },
  },

  camera_shift: {
    configure: () => desc(2, ["float", "float", "float", "string"], [null, null, 1, "QUAD"]),
    validate(esc, a) {
      if (!TRANSITION_TYPES.includes(a[3])) return `Transition type ${a[3]} is not one of the accepted types: ${TRANSITION_TYPES}`;
      const cam = esc.cameraPlayer;
      const p = { x: cam.pos.x + a[0], y: cam.pos.y + a[1] };
      return cam.insideViewportLimits(p) ? null : viewportWarning("camera_shift", p, cam);
    },
    run(esc, a) {
      esc.cameraPlayer.shift(a[0], a[1], a[2], a[3]);
    },
  },

  change_scene: {
    configure: () => desc(1, ["string", "bool", "bool"], [null, true, true]),
    validate: (esc, a) => (esc.game.files[a[0]] ? null : `scene doesn't exist: ${a[0]}`),
    run(esc, a) {
      // like Escoria: not awaited; :setup and :ready run as their own events
      esc.changeScene(a[0]);
    },
  },

  // custom: calls a function of a node's script (the translated GDScript) with
  // the extra arguments as one array (strings with {globals} replaced)
  custom: {
    configure: () => desc(3, ["string", "string", "string", "any"], [null, null, null, []], [true], true),
    validate(esc, a) {
      if (!esc.hasObject(a[0])) return `object not found '${a[0]}'`;
      const n = item(esc, a[0]).node.getNode(a[1]);
      if (!n) return `Invalid node. Object with global id ${a[0]} has no child node called ${a[1]}.`;
      const s = esc.hooks.scriptOf?.(n);
      if (!s || typeof s[a[2]] !== "function") return `Invalid function. Object with global id ${a[0]} and node ${a[1]} has no function called ${a[2]}.`;
      return null;
    },
    run(esc, a) {
      const n = item(esc, a[0]).node.getNode(a[1]);
      const args = (a[3] || []).map((v) => (typeof v === "string" ? esc.globals.replace(v) : v));
      esc.hooks.scriptOf(n)[a[2]](args);
    },
  },

  dec_global: {
    configure: () => desc(2, ["string", ["int", "float"]], [null, 0]),
    validate: (esc, a) => (typeof esc.globals.get(a[0]) === "number" ? null : `global ${a[0]} is not a number`),
    run(esc, a) {
      esc.globals.set(a[0], esc.globals.get(a[0]) - a[1]);
    },
  },

  // show_menu / hide_menu: game.gd show_main_menu / hide_main_menu,
  // pause_game / unpause_game (esc.menus: ui/menus.js or ui/scene_menus.js).
  // Without the transition out and in: the engine only has "instant".
  enable_terrain: {
    configure: () => desc(1, ["string"], [null]),
    run(esc, a) {
      if (esc.terrain && esc.terrain.enable(a[0])) return;
      esc.log(`Can not find terrain node. Terrain node ${a[0]} could not be found.`, "error");
      return RC.ERROR;
    },
  },

  end_block_say: {
    configure: () => desc(0, [], []),
    run(esc) {
      esc.preserveDialogBox = false;
    },
  },

  hide_menu: {
    configure: () => desc(0, ["string"], ["main"]),
    validate: (esc, a) => (["main", "pause"].includes(a[0]) ? null : `Menu ${a[0]} is invalid.`),
    run(esc, a) {
      const m = esc.menus;
      if (!m) return;
      if (a[0] === "pause") m.close();
      else if (m.hideMain) m.hideMain();
      else if (m.screen === "main") m.close();
    },
  },

  inc_global: {
    configure: () => desc(2, ["string", ["int", "float"]], [null, 0]),
    validate: (esc, a) => (typeof esc.globals.get(a[0]) === "number" ? null : `global ${a[0]} is not a number`),
    run(esc, a) {
      esc.globals.set(a[0], esc.globals.get(a[0]) + a[1]);
    },
  },

  inventory_add: {
    configure: () => desc(1, ["string"], [null]),
    validate: (esc, a) => (a[0].includes("/") ? `invalid name ${a[0]}` : null),
    run(esc, a) {
      esc.inventory.add(a[0]);
    },
  },

  inventory_remove: {
    configure: () => desc(1, ["string"], [null]),
    validate: (esc, a) => (a[0].includes("/") ? `invalid name ${a[0]}` : null),
    run(esc, a) {
      esc.inventory.remove(a[0]);
    },
  },

  play_snd: {
    configure: () => desc(1, ["string", "string", "float"], [null, "_sound", 0.0]),
    validate: (esc, a) => (!esc.sounds[a[1]] ? `no sound player '${a[1]}'` : !esc.game.has(a[0]) ? `${a[0]} doesn't exist` : null),
    run(esc, a) {
      esc.sounds[a[1]].setState(a[0], a[2]);
    },
  },

  show_menu: {
    configure: () => desc(0, ["string"], ["main"]),
    validate: (esc, a) => (["main", "pause"].includes(a[0]) ? null : `Menu '${a[0]}' is invalid.`),
    run(esc, a) {
      if (a[0] === "main") esc.menus?.showMain();
      else esc.menus?.showPause();
    },
  },

  slide: {
    configure: () => desc(2, ["string", "string", "int"], [null, null, -1]),
    validate: (esc, a) => mustExist(0)(esc, a) || mustExist(1)(esc, a),
    run(esc, a, cmd) {
      cmd.esc = esc;
      esc.slide(item(esc, a[0]), item(esc, a[1]), a[2]);
    },
    interrupt: (cmd) => cmd.esc?.stopSlides(),
  },

  slide_block: {
    configure: () => desc(2, ["string", "string", "int"], [null, null, -1]),
    validate: (esc, a) => mustExist(0)(esc, a) || mustExist(1)(esc, a),
    async run(esc, a, cmd) {
      cmd.esc = esc;
      await esc.slide(item(esc, a[0]), item(esc, a[1]), a[2]);
    },
    interrupt: (cmd) => cmd.esc?.stopSlides(),
  },

  spawn: {
    configure: () => desc(2, ["string", "string", "bool", "string"], [null, null, true, null]),
    validate: (esc, a) => (!a[0] || a[0].startsWith("_") ? `invalid global_id '${a[0]}'` : !esc.game.files[a[1]] ? `scene doesn't exist: ${a[1]}` : a[3] && !esc.hasObject(a[3]) ? `object not found '${a[3]}'` : null),
    async run(esc, a) {
      await esc.spawn(a[0], a[1], a[2], a[3] ? esc.getObject(a[3]).position : null);
    },
  },

  stop_snd: {
    configure: () => desc(0, ["string"], ["_music"]),
    validate: (esc, a) => (esc.sounds[a[0]] ? null : `no sound player '${a[0]}'`),
    run(esc, a) {
      esc.sounds[a[0]].setState("off");
    },
  },

  print: {
    configure: () => desc(1, ["string"], [null]),
    run(esc, a) {
      esc.log(esc.globals.replace(a[0]));
    },
  },

  queue_event: {
    configure: () => desc(2, ["string", "string", "string", "bool"], [null, null, "_front", false]),
    validate: (esc, a) => {
      const o = a[0] === esc.roomObject?.globalId ? esc.roomObject : esc.getObject(a[0]);
      if (!o) return `object not found '${a[0]}'`;
      return o.events.has(a[1]) ? null : `${a[0]} has no event :${a[1]}`;
    },
    async run(esc, a) {
      const o = a[0] === esc.roomObject?.globalId ? esc.roomObject : esc.getObject(a[0]);
      const ev = o.events.get(a[1]);
      if (esc.events.changingScene) return RC.WONT_QUEUE;
      if (a[2] === "_front") esc.events.queue(ev);
      else esc.events.queueBackground(a[2], ev);
      if (a[3]) return esc.events.waitFinished(a[1], a[2]);
      return RC.OK;
    },
  },

  say: {
    configure: () => desc(2, ["string", "string", "string", "string"], [null, null, "", ""], [true, false, false, true]),
    validate: (esc, a) => (a[0].toUpperCase() === "CURRENT_PLAYER" || esc.hasObject(a[0]) ? null : `object not found '${a[0]}'`),
    async run(esc, a, cmd) {
      if (!esc.player) {
        esc.log("say with no player in the room", "warn");
        return RC.CANCEL;
      }
      const id = a[0].toUpperCase() === "CURRENT_PLAYER" ? esc.player.globalId : a[0];
      const obj = item(esc, id);
      const text = esc.globals.replace(a[1]);
      if (!esc.ui.say) {
        esc.log(`${id}: ${text}`, "say");
        return RC.OK;
      }
      esc.state = "DIALOG";
      // a game's floating dialog script (floating.gd) animates the talking itself
      const scripted = esc.hooks.ui && esc.hooks.ui.dialog && esc.hooks.ui.dialog.active();
      if (!scripted) startTalking(obj);
      // say(object, text, key, type): dialog_player.say(character, type, text, key)
      await esc.ui.say(obj, text, { key: a[2], type: a[3], cmd });
      if (!scripted) stopTalking(obj);
      esc.state = "DEFAULT";
      return RC.OK;
    },
  },

  // sched_event: queues an event of an object's (or the room's) script after `time` seconds
  sched_event: {
    configure: () => desc(3, [["float", "int"], "string", "string"], [null, null, null]),
    validate(esc, a) {
      const isRoom = esc.roomObject && esc.roomObject.globalId === a[1];
      if (!esc.hasObject(a[1]) && !isRoom) return `object not found '${a[1]}'`;
      const node = isRoom ? esc.roomObject.node : item(esc, a[1]).node;
      if (!node.props.esc_script) return `${a[1]} has no ESC script.`;
      if (!esc.compileScript(node.props.esc_script, isRoom ? "" : a[1]).events.has(a[2])) return `${a[1]}'s script has no event ${a[2]}.`;
      return null;
    },
    run(esc, a) {
      const isRoom = esc.roomObject && esc.roomObject.globalId === a[1];
      const node = isRoom ? esc.roomObject.node : item(esc, a[1]).node;
      esc.events.schedule(esc.compileScript(node.props.esc_script, isRoom ? "" : a[1]).events.get(a[2]), a[0]);
    },
  },

  set_active: {
    configure: () => desc(2, ["string", "bool"], [null, null]),
    validate: mustExist(),
    run(esc, a) {
      item(esc, a[0]).active = a[1];
    },
  },

  set_angle: {
    configure: () => desc(2, ["string", ["float", "int"], ["float", "int"]], [null, null, 0.0]),
    validate: mustExist(),
    async run(esc, a) {
      const m = item(esc, a[0]).movable;
      if (!m) return esc.log(`${a[0]} is not movable`, "warn");
      const deg = (((Math.trunc(a[1]) - 90) % 360) + 360) % 360;
      m.setAngle(deg, a[2], esc); // not awaited, as in Escoria
    },
  },

  set_animations: {
    configure: () => desc(2, ["string", "string"], [null, null]),
    validate: (esc, a) => mustExist()(esc, a) || (esc.game.files[a[1]] ? null : `resource ${a[1]} doesn't exist`),
    run(esc, a) {
      const obj = item(esc, a[0]);
      const res = esc.game.resource(a[1]);
      obj.node.props.animations = res;
      if (obj.movable) obj.movable.anims = res.props;
      const all = { ...(esc.globals.get("ANIMATION_RESOURCES") || {}) };
      all[a[0]] = a[1];
      esc.globals.set("ANIMATION_RESOURCES", all, true);
    },
  },

  set_global: {
    configure: () => desc(2, ["string", "any", "bool"], [null, null, false]),
    run(esc, a) {
      esc.globals.set(a[0], a[1], a[2]);
    },
  },

  set_gui_visible: {
    configure: () => desc(1, ["bool"], [null]),
    run(esc, a) {
      esc.ui.setGuiVisible?.(a[0]);
    },
  },

  set_interactive: {
    configure: () => desc(2, ["string", "bool"], [null, null]),
    validate: mustExist(),
    run(esc, a) {
      item(esc, a[0]).interactive = a[1];
    },
  },

  set_state: {
    configure: () => desc(2, ["string", "string", "bool"], [null, null, false]),
    validate: mustExist(),
    run(esc, a) {
      item(esc, a[0]).setState(a[1], a[2]);
    },
  },

  teleport: {
    configure: () => desc(2, ["string", "string"], [null, null]),
    validate: (esc, a) => mustExist(0)(esc, a) || mustExist(1)(esc, a),
    run(esc, a) {
      const m = item(esc, a[0]).movable;
      if (!m) return esc.log(`${a[0]} is not movable`, "warn");
      m.teleportTo(item(esc, a[1]).interactPosition());
    },
  },

  teleport_pos: {
    configure: () => desc(3, ["string", "int", "int"], [null, null, null]),
    validate: mustExist(),
    run(esc, a) {
      const m = item(esc, a[0]).movable;
      if (!m) return esc.log(`${a[0]} is not movable`, "warn");
      m.teleportTo({ x: Math.trunc(a[1]), y: Math.trunc(a[2]) });
    },
  },

  transition: {
    configure: () => desc(2, ["string", "string", "float"], [null, null, 1.0]),
    validate(esc, a) {
      if (a[0] && !esc.transitions.has(a[0])) return `Argument invalid. Transition with name '${a[0]}' doesn't exist.`;
      if (!["in", "out"].includes(a[1])) return `Argument invalid. Transition type 'in' or 'out' expected, but '${a[1]}' was provided.`;
      return null;
    },
    async run(esc, a) {
      await esc.transitions.transition(a[0], a[1], a[2]);
    },
  },

  turn_to: {
    configure: () => desc(2, ["string", "string", "float"], [null, null, 0.0]),
    validate: (esc, a) => mustExist(0)(esc, a) || mustExist(1)(esc, a),
    run(esc, a) {
      const m = item(esc, a[0]).movable;
      if (!m) return esc.log(`${a[0]} is not movable`, "warn");
      m.turnTo(item(esc, a[1]).node, a[2], esc);
    },
  },

  wait: {
    configure: () => desc(1, [["int", "float"]], [null]),
    validate: (esc, a) => (a[0] > 0 ? null : `invalid time ${a[0]}`),
    async run(esc, a, cmd) {
      await esc.wait(a[0], cmd);
    },
  },

  walk: {
    configure: () => desc(2, ["string", "string", "bool"], [null, null, false]),
    validate: (esc, a) => mustExist(0)(esc, a) || mustExist(1)(esc, a),
    run(esc, a) {
      walkItem(esc, a[0], a[1], a[2]);
    },
  },

  walk_block: {
    configure: () => desc(2, ["string", "string", "bool"], [null, null, false]),
    validate: (esc, a) => mustExist(0)(esc, a) || mustExist(1)(esc, a),
    async run(esc, a) {
      walkItem(esc, a[0], a[1], a[2]);
      const m = item(esc, a[0]).movable;
      if (m) await m.arrived();
    },
  },

  walk_to_pos: {
    configure: () => desc(3, ["string", "int", "int", "bool"], [null, null, null, false]),
    validate: mustExist(),
    run(esc, a) {
      walkItem(esc, a[0], { x: a[1], y: a[2] }, a[3]);
    },
  },

  walk_to_pos_block: {
    configure: () => desc(3, ["string", "int", "int", "bool"], [null, null, null, false]),
    validate: mustExist(),
    async run(esc, a) {
      walkItem(esc, a[0], { x: a[1], y: a[2] }, a[3]);
      const m = item(esc, a[0]).movable;
      if (m) await m.arrived();
    },
  },
};
