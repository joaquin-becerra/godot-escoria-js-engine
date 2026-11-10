// ESCActionManager (esc/esc_action_manager.gd): verb + item (+ second item),
// walking to the item and queueing the right event, with the fallbacks of
// the action default script (escoria/main/action_default_script).
// Escoria, MIT license, (c) Godot Escoria contributors.
//
// Games that patched Escoria change it from their ports: esc.hooks.combinationFallback (combinations
// nothing handles try "<verb>_with" first) and the hook
// `beforeEvent(target, combineWith)` (called before an event is looked up).
import { eventKey } from "./ashes/compiler.js";
import { EV } from "./events.js";

export const STATE = Object.freeze({
  AWAITING_VERB_OR_ITEM: "AWAITING_VERB_OR_ITEM",
  AWAITING_ITEM: "AWAITING_ITEM",
  AWAITING_TARGET_ITEM: "AWAITING_TARGET_ITEM",
  AWAITING_VERB: "AWAITING_VERB",
  AWAITING_VERB_CONFIRMATION: "AWAITING_VERB_CONFIRMATION",
  COMPLETED: "COMPLETED",
});

const ACTION_ARRIVED = "arrived";
const ACTION_EXIT_SCENE = "exit_scene";
const ACTION_WALK = "walk";

const list = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.args) ? v.args : []);
const hasEvent = (obj, name, target = "") => !!obj && obj.events.has(eventKey(name, target));
const getEvent = (obj, name, target = "") => obj.events.get(eventKey(name, target)) || null;

export class ActionManager {
  constructor(esc) {
    this.esc = esc;
    this.currentAction = "";
    this.currentTool = null;
    this.currentTarget = null;
    this.state = STATE.AWAITING_VERB_OR_ITEM;
    this.listeners = new Set(); // () => void, on every change (UI)
    this.beforeEvent = null;
    const file = esc.game.setting("escoria/main/action_default_script", "");
    this.defaults = file ? esc.compileScript(file) : null;
  }

  changed() {
    for (const l of this.listeners) l();
  }

  setState(s) {
    this.state = s;
    this.changed();
  }

  setCurrentAction(action) {
    if (action !== this.currentAction) this.clearCurrentTool();
    this.currentAction = action;
    if (this.state === STATE.AWAITING_VERB_OR_ITEM) this.state = STATE.AWAITING_ITEM;
    else if (this.state === STATE.AWAITING_VERB) this.state = STATE.AWAITING_VERB_CONFIRMATION;
    this.changed();
  }

  clearCurrentAction() {
    this.setCurrentAction("");
    this.setState(STATE.AWAITING_VERB_OR_ITEM);
  }

  clearCurrentTool() {
    this.currentTool = null;
    this.currentTarget = null;
    if (this.state === STATE.AWAITING_VERB) this.state = STATE.AWAITING_VERB_OR_ITEM;
    else if (this.state === STATE.AWAITING_TARGET_ITEM) this.state = STATE.AWAITING_ITEM;
  }

  // ---------------------------------------------------------------- do()

  /** Background click: walk `obj` to a position or an object. */
  backgroundClick(objId, target, fast = false, canInterrupt = true) {
    if (this.esc.state !== "DEFAULT") return;
    if (canInterrupt) this.esc.events.interrupt([], false);
    const obj = this.esc.getObject(objId);
    if (!obj) return this.esc.log(`Walk action requested for nonexisting object: ${objId}.`, "error");
    if (typeof target === "string") {
      const t = this.esc.getObject(target);
      if (!t) return this.esc.log(`Walk action requested to nonexisting destination object: ${target}.`, "error");
      target = t;
    }
    this.performWalk(obj, target, fast);
  }

  /** Left / right click on an item: [id, {position, doubleClick}] */
  itemClick(id, event, canInterrupt = true) {
    if (this.esc.state !== "DEFAULT") return;
    if (canInterrupt) this.esc.events.interrupt([], false);
    const obj = this.esc.getObject(id);
    if (obj) return this.performInputEventOnObject(obj, event);
  }

  performWalk(obj, dest, fast = false) {
    if (!obj.movable) return this.esc.log(`${obj.globalId} is not movable`, "warn");
    if (dest && dest.globalId) {
      const pos = dest.node.scriptName === "esc_location" ? dest.position : dest.interactPosition();
      return obj.movable.walkTo(pos, { fast, target: dest.node });
    }
    obj.movable.walkTo(dest, { fast });
  }

  // ---------------------------------------------------------------- events

  _getEventToQueue(action, target, combineWith = null) {
    this.beforeEvent?.(target, combineWith);
    const esc = this.esc;
    const inv = (o) => esc.inventory.has(o.globalId);
    const requiring = list(target.node.props.actions_requiring_target_object);
    if (requiring.includes(action)) {
      if (inv(target) || !target.node.props.use_from_inventory_only) {
        if (combineWith) {
          let doCombine = true;
          if (combineWith.node.props.use_from_inventory_only && !inv(combineWith)) doCombine = false;
          if (doCombine) {
            if (hasEvent(target, action, combineWith.globalId)) return getEvent(target, action, combineWith.globalId);
            if (hasEvent(combineWith, action, target.globalId) && !combineWith.node.props.combine_is_one_way) return getEvent(combineWith, action, target.globalId);
            // a game that patched this in Escoria (its ports): another event
            // before the default script's (esc.hooks.combinationFallback)
            const patched = esc.hooks.combinationFallback?.(target, action, combineWith, { hasEvent, getEvent, defaults: this.defaults });
            if (patched) return patched;
            if (hasEvent(this.defaults, action)) return getEvent(this.defaults, action);
            esc.log(`Invalid action: no :${action} ${combineWith.globalId} in ${target.globalId}`, "warn");
          } else esc.log(`${combineWith.globalId} has to be in the inventory`, "warn");
        }
      } else esc.log(`${target.globalId} has to be in the inventory for '${action}'`, "warn");
      return null;
    }
    if (hasEvent(target, action)) return getEvent(target, action);
    if (hasEvent(this.defaults, action)) return getEvent(this.defaults, action);
    esc.log(`Invalid action: no :${action} for '${target.globalId}'`, "warn");
    return null;
  }

  async _runEvent(event) {
    this.esc.events.queue(event);
    const rc = await this.esc.events.waitFinished(event.name);
    this.clearCurrentAction();
    return rc;
  }

  _setToolAndAction(obj, defaultAction) {
    let justSet = false;
    if (this.currentAction && this.currentTool) {
      if (!list(this.currentTool.node.props.actions_requiring_target_object).includes(this.currentAction)) {
        this.currentTool = obj;
        justSet = true;
      }
    } else if (defaultAction) {
      this.currentAction = this.esc.inventory.has(obj.globalId) ? obj.node.props.default_action_inventory || "" : obj.node.props.default_action || "";
    } else if (list(obj.node.props.actions_requiring_target_object).includes(this.currentAction)) {
      this.currentTool = obj;
      justSet = true;
    }
    return justSet;
  }

  _requiresTarget() {
    return !!(this.currentAction && this.currentTool && list(this.currentTool.node.props.actions_requiring_target_object).includes(this.currentAction));
  }

  /** perform_inputevent_on_object() */
  async performInputEventOnObject(obj, event = {}, defaultAction = false) {
    const esc = this.esc;
    const inv = (o) => esc.inventory.has(o.globalId);
    let dontInteract = false;
    const justSet = this._setToolAndAction(obj, defaultAction);
    const requires = this._requiresTarget();
    if ((!inv(obj) && !this.currentTool) || (this.currentTool && !requires)) this.currentTool = obj;
    else if (requires && !justSet) this.currentTarget = obj;

    if (this.state === STATE.AWAITING_TARGET_ITEM && this.currentTarget) this.setState(STATE.COMPLETED);
    else if (this.state === STATE.AWAITING_ITEM && !requires) this.setState(STATE.COMPLETED);
    else if (this.state === STATE.AWAITING_ITEM && requires && !justSet) this.setState(STATE.AWAITING_TARGET_ITEM);

    let ev = null;
    const walkish = ["", ACTION_WALK].includes(this.currentAction);
    if (obj.node.props.is_exit && walkish) ev = this._getEventToQueue(ACTION_EXIT_SCENE, obj);
    else if (walkish && !inv(obj)) ev = this._getEventToQueue(ACTION_ARRIVED, obj);
    else if (!walkish) {
      if (requires && this.currentTarget) ev = this._getEventToQueue(this.currentAction, this.currentTool, this.currentTarget);
      else if (requires) {
        this.setState(STATE.AWAITING_TARGET_ITEM);
        if (inv(obj)) this.currentTool = obj;
        return;
      } else ev = this._getEventToQueue(this.currentAction, obj);
    }
    if (this.currentAction && !ev) {
      this.clearCurrentAction();
      return;
    }
    const player = esc.player;
    if (player) {
      let dest = player.position;
      if (obj !== player && !inv(obj) && !this._telekinetic(ev)) {
        const ctx = await this._walkTowards(obj, event.position || obj.position, !!event.doubleClick);
        if (!ctx) return; // interrupted walk
        dest = ctx.position;
        dontInteract = ctx.dontInteract;
      }
      const p = player.position;
      if (Math.hypot(p.x - dest.x, p.y - dest.y) > 1) {
        dontInteract = true;
        esc.log(`the player didn't reach ${Math.round(dest.x)}, ${Math.round(dest.y)}: the action on ${obj.globalId} doesn't run`, "warn");
        if (hasEvent(obj, EV.CANT_REACH)) esc.events.queue(getEvent(obj, EV.CANT_REACH));
      }
    }
    if (!dontInteract && ev) this._runEvent(ev);
  }

  _telekinetic(ev) {
    if (!ev || !("TK" in ev.flags)) return false;
    const cond = ev.flags.TK;
    if (cond) {
      const v = this.esc.globals.get(cond.name.lexeme);
      return v === null ? false : !!v;
    }
    return true;
  }

  async _walkTowards(obj, clicked, fast) {
    const player = this.esc.player;
    let dest, dontInteract = false;
    if (obj.interactive) dest = obj.interactPosition();
    else {
      dest = clicked;
      dontInteract = true;
    }
    player.movable.walkTo(dest, { fast, target: obj.node });
    const ctx = await player.movable.arrived();
    if (ctx.target !== obj.node) return null;
    return { position: dest, dontInteract };
  }
}
