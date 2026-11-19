// Godot's Object, Signal and Callable, for code translated from GDScript.
import { truthy } from "./values.js";

// ---------------------------------------------------------------- signals and callables

/** A signal: connect / disconnect / emit, and `await signal` (it is thenable). */
export class Signal {
  constructor(owner, name) {
    this.owner = owner;
    this.name = name;
    this.slots = [];
  }
  connect(target, flags = 0) {
    const f = target instanceof Callable ? target : new Callable(null, target);
    this.slots.push({ f, oneShot: !!(flags & 4) });
    return 0;
  }
  disconnect(target) {
    this.slots = this.slots.filter((s) => s.f !== target && s.f.fn !== target && !(target instanceof Callable && s.f.same(target)));
  }
  is_connected(target) {
    return this.slots.some((s) => s.f === target || (target instanceof Callable && s.f.same(target)));
  }
  emit(...args) {
    const slots = this.slots;
    this.slots = slots.filter((s) => !s.oneShot);
    for (const s of slots) s.f.callv(args);
  }
  then(resolve, reject) {
    // `await signal`: the first emission (one argument -> that value, several -> the array)
    return new Promise((ok) => {
      const f = new Callable(null, (...a) => ok(a.length === 0 ? null : a.length === 1 ? a[0] : a));
      this.slots.push({ f, oneShot: true });
    }).then(resolve, reject);
  }
}

/** Callable(object, "method") or a function, with bind(). */
export class Callable {
  constructor(obj, method, bound = []) {
    this.obj = obj;
    this.method = method;
    this.bound = bound;
    if (typeof method === "function") this.fn = method;
  }
  bind(...args) {
    return new Callable(this.obj, this.method, [...this.bound, ...args]);
  }
  call(...args) {
    return this.callv(args);
  }
  callv(args) {
    const all = [...args, ...this.bound];
    if (this.fn) return this.fn.apply(this.obj, all);
    const f = this.obj && this.obj[this.method];
    if (typeof f !== "function") throw new TypeError(`Callable: ${this.method}() doesn't exist`);
    return f.apply(this.obj, all);
  }
  call_deferred(...args) {
    Promise.resolve().then(() => this.call(...args));
  }
  is_valid() {
    return !!(this.fn || (this.obj && typeof this.obj[this.method] === "function"));
  }
  same(o) {
    return o.obj === this.obj && o.method === this.method;
  }
}

/** Object: signals by name. */
export class GdObject {
  constructor() {
    this.__signals = new Map();
  }
  get __isGdObject() {
    return true;
  }
  signal(name) {
    if (!this.__signals.has(name)) this.__signals.set(name, new Signal(this, name));
    return this.__signals.get(name);
  }
  connect(name, target, flags = 0) {
    return this.signal(name).connect(target, flags);
  }
  disconnect(name, target) {
    this.signal(name).disconnect(target);
  }
  is_connected(name, target) {
    return this.signal(name).is_connected(target);
  }
  emit_signal(name, ...args) {
    this.signal(name).emit(...args);
  }
  has_signal(name) {
    return this.__signals.has(name);
  }
  has_method(name) {
    return typeof this[name] === "function";
  }
  call(name, ...args) {
    return this[name](...args);
  }
  callv(name, args) {
    return this[name](...args);
  }
  get(prop) {
    return this[prop];
  }
  set(prop, v) {
    this[prop] = v;
  }
  is_class(name) {
    for (let c = this.constructor; c && c !== Object; c = Object.getPrototypeOf(c)) if (c.gdClass === name || c.name === name) return true;
    return false;
  }
  get_class() {
    return this.constructor.gdClass || this.constructor.name;
  }
  notification() {}
  // metadata (nodes keep theirs with the engine node)
  set_meta(k, v) { (this.__meta ||= {})[k] = v; }
  get_meta(k, def = null) { return this.__meta && k in this.__meta ? this.__meta[k] : def; }
  has_meta(k) { return !!this.__meta && k in this.__meta; }
  remove_meta(k) { if (this.__meta) delete this.__meta[k]; }
  get_meta_list() { return Object.keys(this.__meta || {}); }
  tr(s) { return this.__bridge ? this.__bridge.game.tr(String(s)) : String(s); }
  tr_n(s, plural, n) { return this.tr(n === 1 ? s : plural); }
  /** Declares a script var on the instance (not one of the node's properties). */
  __field(k, v) {
    Object.defineProperty(this, k, { value: v, writable: true, enumerable: true, configurable: true });
  }
  __export(_name, def) {
    return def;
  }
}

/** A GdObject with these properties (getters and setters kept, unlike Object.assign). */
export function gdObject(props) {
  return Object.defineProperties(new GdObject(), Object.getOwnPropertyDescriptors(props));
}
