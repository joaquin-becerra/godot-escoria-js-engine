// ESCEventManager (esc/esc_event_manager.gd): event queues per channel
// ("_front" plus background channels), one runtime interpreter per event run.
import { Interpreter, RC, interruptEvent } from "./ashes/interpreter.js";
import { FLAG_NO_UI, FLAG_NO_TT, FLAG_NO_SAVE } from "./ashes/parser.js";

export const CHANNEL_FRONT = "_front";
export const EV = Object.freeze({
  INIT: "init", NEW_GAME: "newgame", LOAD: "load", RESUME: "resume", READY: "ready", SETUP: "setup",
  EXIT_SCENE: "exit_scene", TRANSITION_IN: "transition_in", TRANSITION_OUT: "transition_out", CANT_REACH: "cant_reach",
});

export class EventManager {
  constructor(esc) {
    this.esc = esc;
    this.queues = new Map([[CHANNEL_FRONT, []]]);
    this.running = new Map(); // channel -> event
    this.busy = new Map(); // channel -> true while an event runs
    this.listeners = []; // (rc, name, channel) => void
    this.scheduled = []; // {event, timeout}
    this.changingScene = false;
  }

  isChannelFree(channel) {
    return !this.busy.get(channel);
  }

  runningEvent(channel = CHANNEL_FRONT) {
    return this.running.get(channel) || null;
  }

  /** Called every frame. */
  tick(dt) {
    for (const [channel, queue] of this.queues) {
      if (!queue.length || !this.isChannelFree(channel)) continue;
      const event = queue.shift();
      this.busy.set(channel, true);
      this.running.set(channel, event);
      if (event.flagBits & FLAG_NO_UI) this.esc.ui.setGuiVisible?.(false);
      if (event.flagBits & FLAG_NO_TT) this.esc.ui.setTooltipVisible?.(false);
      if (event.flagBits & FLAG_NO_SAVE) this.esc.saveEnabled = false;
      this.esc.log(`▶ :${event.name}${event.target ? " " + event.target : ""}${event.objectGlobalId ? " (" + event.objectGlobalId + ")" : ""}${channel !== CHANNEL_FRONT ? " [" + channel + "]" : ""}`, "event");
      const interpreter = new Interpreter(this.esc, channel);
      event.interpreter = interpreter;
      interpreter
        .run(event)
        .catch((e) => {
          this.esc.log(`JS error in :${event.name}: ${e.stack || e}`, "error");
          return RC.ERROR;
        })
        .then((rc) => this.finished(event, rc, channel));
    }
    for (const s of [...this.scheduled]) {
      s.timeout -= dt;
      if (s.timeout <= 0) {
        this.scheduled.splice(this.scheduled.indexOf(s), 1);
        this.queues.get(CHANNEL_FRONT).push(s.event);
      }
    }
  }

  finished(event, rc, channel) {
    if (this.running.get(channel) !== event) return;
    if (event.flagBits & FLAG_NO_UI) this.esc.ui.setGuiVisible?.(true);
    if (event.flagBits & FLAG_NO_TT) this.esc.ui.setTooltipVisible?.(true);
    if (event.flagBits & FLAG_NO_SAVE) this.esc.saveEnabled = true;
    if (rc === RC.CANCEL) rc = RC.OK;
    else if (rc === RC.ERROR) {
      this.esc.log(`:${event.name} ended with an error; input goes back to ALL`, "warn");
      this.esc.inputMode = "ALL";
    }
    this.esc.log(`■ :${event.name} (rc ${rc})`, "event");
    this.running.set(channel, null);
    this.busy.set(channel, false);
    for (const l of [...this.listeners]) l(rc, event.name, channel);
  }

  /** Resolves with the return code when an event called `name` finishes on `channel`. */
  waitFinished(name, channel = CHANNEL_FRONT) {
    return new Promise((ok) => {
      const l = (rc, n, ch) => {
        if (n !== name || ch !== channel) return;
        this.listeners.splice(this.listeners.indexOf(l), 1);
        ok(rc);
      };
      this.listeners.push(l);
    });
  }

  queue(event, force = false, asFirst = false) {
    if (!event) return;
    if (this.changingScene && !force) {
      this.esc.log(`changing room: :${event.name} not queued`);
      return;
    }
    const q = this.queues.get(CHANNEL_FRONT);
    const last = q[q.length - 1];
    if (last && last.name === event.name) return; // the same event twice in a row
    const running = this.runningEvent(CHANNEL_FRONT);
    if (running && running.name === event.name) return;
    if (asFirst) q.unshift(event);
    else q.push(event);
  }

  queueBackground(channel, event) {
    if (!this.queues.has(channel)) this.queues.set(channel, []);
    this.queues.get(channel).push(event);
  }

  schedule(event, timeout) {
    this.scheduled.push({ event, timeout });
  }

  /** Interrupts running events and clears the queues, except the events named in `exceptions`. */
  interrupt(exceptions = [], stopWalking = true) {
    if (stopWalking && this.esc.player && this.esc.player.movable && this.esc.player.movable.walking) {
      this.esc.player.movable.stop(this.esc.player.movable.position);
    }
    // esc.hooks.keepsChannel(channel, changingScene): a game's channels that outlive this
    const keeps = (channel) => this.esc.hooks.keepsChannel?.(channel, this.changingScene);
    for (const [channel, ev] of this.running) {
      if (ev && !exceptions.includes(ev.name) && !keeps(channel)) {
        interruptEvent(ev);
        this.busy.set(channel, false);
      }
    }
    for (const [channel, q] of this.queues) {
      if (!keeps(channel)) this.queues.set(channel, q.filter((e) => exceptions.includes(e.name)));
    }
  }

  /** Interrupts what runs on one channel and clears its queue. */
  interruptChannel(channel) {
    const ev = this.running.get(channel);
    if (ev) {
      interruptEvent(ev);
      this.busy.set(channel, false);
    }
    if (this.queues.has(channel)) this.queues.set(channel, []);
  }

  setChangingScene(v) {
    this.changingScene = v;
    if (v) this.interrupt([EV.INIT, EV.EXIT_SCENE, EV.NEW_GAME, EV.LOAD, EV.RESUME, "change_scene", "change_scene_godot"]);
  }
}
