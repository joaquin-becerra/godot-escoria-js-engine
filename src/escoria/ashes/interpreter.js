// ASHES interpreter: runs one event. Port of
// escoria-core/game/core-scripts/esc/compiler/esc_interpreter.gd
// (Escoria, MIT license, (c) Godot Escoria contributors).
//
// Waiting commands (walk, say, wait...) are async functions: GDScript's
// `await` becomes JS `await`. Control flow (stop, break, done) is returned
// as the statement object, like Escoria does.
import { T } from "./scanner.js";
import { resolve } from "./compiler.js";

export const RC = Object.freeze({ OK: 0, ERROR: 1, CANCEL: 2, INTERRUPTED: 3, WONT_QUEUE: 4 });

const CURRENT_PLAYER = "CURRENT_PLAYER";
const CURRENT_OBJECT = "THIS";
const BUILTINS = ["print"];
// ESCCompiler.load_globals(): the reserved objects are globals of the
// interpreter whose value is their own name (play_snd(x, _music))
export const RESERVED_OBJECTS = ["_camera", "_music", "_sound", "_speech", "_ambient"];

class Environment {
  constructor(enclosing = null) {
    this.enclosing = enclosing;
    this.values = new Map();
  }
  define(name, value) {
    this.values.set(name, value);
  }
  ancestor(distance) {
    let env = this;
    for (let i = 0; i < distance; i++) env = env.enclosing;
    return env;
  }
  getAt(distance, name) {
    return this.ancestor(distance).values.get(name) ?? null;
  }
  assignAt(distance, name, value) {
    this.ancestor(distance).values.set(name, value);
  }
}

/** Breaks out of several nested dialogs (ESCBreakCounter). */
class BreakCounter {
  constructor() {
    this.levelsLeft = 0;
    this.resumeParent = false;
  }
  advanceUpOneLevel() {
    if (this.levelsLeft > 0) this.levelsLeft--;
    if (this.levelsLeft === 0) this.resumeParent = true;
  }
}

const isTruthy = (v) => {
  if (v === null || v === undefined) return false;
  if (typeof v === "number" || typeof v === "boolean") return !!v;
  if (typeof v === "string") return v.length > 0;
  return false;
};
// GDScript's `not a`: null, false, 0, "" (and empty containers) are "not"
const isFalsy = (v) => v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) && !v.length);
const isNumber = (v) => typeof v === "number";

/**
 * @param esc the Escoria runtime (objects, globals, inventory, commands, log...)
 * @param channel event channel this interpreter runs on
 */
export class Interpreter {
  constructor(esc, channel = "") {
    this.esc = esc;
    this.channel = channel;
    this.locals = new Map();
    this.globals = new Environment(); // `var` at the top level of nothing: not used by events
    this.environment = this.globals;
    this.currentEvent = null;
    this.dialogDepth = 0;
  }

  error(msg) {
    this.esc.log(`ASHES: ${msg}`, "error");
  }

  /** Runs an Event statement. Returns its return code. */
  async run(event) {
    resolve(event, this.locals);
    return this.execute(event);
  }

  interrupt() {
    if (this.currentEvent) interruptEvent(this.currentEvent);
  }

  // ---------------------------------------------------------------- statements

  async execute(s) {
    switch (s.kind) {
      case "Event": return this.event(s);
      case "Block": return this.executeBlock(s.statements, new Environment(this.environment));
      case "Expression": {
        // In Escoria only command calls give an int (their return code);
        // script numbers are floats, so other values never count as one. JS
        // has a single number type: keep the result of calls only.
        const v = await this.evaluate(s.expr);
        return s.expr.kind === "Call" ? v : null;
      }
      case "If": {
        if (isTruthy(await this.evaluate(s.cond))) return this.execute(s.then);
        for (const b of s.elifs) if (isTruthy(await this.evaluate(b.cond))) return this.execute(b.then);
        if (s.else) return this.execute(s.else);
        return null;
      }
      case "While": {
        while (isTruthy(await this.evaluate(s.cond))) {
          const ret = await this.execute(s.body);
          if (ret && ret.kind === "Break") break;
          if (this.isTerminal(ret)) return ret;
        }
        return null;
      }
      case "Pass": return null;
      case "Stop":
      case "Break":
      case "Done":
        return s;
      case "Var": {
        const value = s.init ? await this.evaluate(s.init) : null;
        this.environment.define(s.name.lexeme, value);
        return null;
      }
      case "Global": {
        const value = s.init ? await this.evaluate(s.init) : null;
        // only defined once; later declarations are ignored
        if (!this.esc.globals.has(s.name.lexeme)) this.esc.globals.set(s.name.lexeme, value);
        return null;
      }
      case "Dialog": return this.dialog(s);
      case "DialogOption": return null;
    }
    this.error(`unknown statement ${s.kind}`);
    return RC.ERROR;
  }

  async event(s) {
    this.currentEvent = s;
    s.interrupted = false;
    let rc = await this.execute(s.body);
    this.currentEvent = null;
    if (typeof rc !== "number") rc = RC.OK;
    if (s.interrupted) rc = RC.INTERRUPTED;
    return rc || RC.OK;
  }

  async executeBlock(statements, env) {
    const previous = this.environment;
    this.environment = env;
    try {
      let ret = null;
      for (const st of statements) {
        ret = await this.execute(st);
        if (this.currentEvent && this.currentEvent.interrupted) return RC.INTERRUPTED;
        if (ret && ret.kind === "Break") return ret;
        if (this.isTerminal(ret)) return ret;
      }
      return ret;
    } finally {
      this.environment = previous;
    }
  }

  isTerminal(ret) {
    if (ret && (ret.kind === "Stop" || ret.kind === "Done" || ret instanceof BreakCounter)) return true;
    return ret === RC.ERROR || ret === RC.INTERRUPTED;
  }

  async dialog(s) {
    let rc = RC.OK;
    this.dialogDepth++;
    try {
      const dialog = { avatar: "", timeout: 0, timeoutOption: 0, options: [] };
      if (s.args.length > 0) {
        const avatar = await this.evaluate(s.args[0]);
        if (avatar !== null && typeof avatar !== "string") {
          this.error("Dialog avatar must evaluate to a String.");
          return RC.ERROR;
        }
        dialog.avatar = avatar === null ? "<null>" : avatar;
      }
      for (const [i, field] of [[1, "timeout"], [2, "timeoutOption"]]) {
        if (s.args.length <= i) continue;
        const v = await this.evaluate(s.args[i]);
        if (!isNumber(v) || v < 0) {
          this.error(`Dialog ${field} must be a number >= 0.`);
          return RC.ERROR;
        }
        dialog[field] = Math.trunc(v);
      }
      for (;;) {
        dialog.options = [];
        for (let i = 0; i < s.options.length; i++) {
          const o = s.options[i];
          const valid = o.cond ? isTruthy(await this.evaluate(o.cond)) : true;
          if (valid) dialog.options.push({ source: o, index: i + 1, key: o.key, text: await this.evaluate(o.option) });
        }
        if (!dialog.options.length) break;
        if (this.currentEvent && this.currentEvent.interrupted) return RC.INTERRUPTED;
        const chosen = await this.esc.chooseDialogOption(dialog);
        if (!chosen) break;
        const ret = await this.execute(chosen.source.body);
        if (ret === RC.ERROR) return RC.ERROR;
        if (this.currentEvent && this.currentEvent.interrupted) return RC.INTERRUPTED;
        if (ret && ret.kind === "Break") {
          const levelsLeft = ret.levels ? (await this.evaluate(ret.levels)) - 1 : 0;
          if (this.dialogDepth === 1) break;
          const b = new BreakCounter();
          if (levelsLeft > 0) b.levelsLeft = levelsLeft;
          else b.resumeParent = true;
          return b;
        }
        if (ret && ret.kind === "Done") return this.dialogDepth === 1 ? rc : ret;
        if (ret && ret.kind === "Stop") return ret;
        if (ret instanceof BreakCounter) {
          if (ret.levelsLeft > 0) {
            if (this.dialogDepth === 1) break;
            ret.advanceUpOneLevel();
            return ret;
          }
          if (ret.resumeParent) {
            ret.resumeParent = false;
            continue;
          }
          break;
        }
      }
      return rc;
    } finally {
      this.dialogDepth--;
    }
  }

  // ---------------------------------------------------------------- expressions

  async evaluate(e) {
    switch (e.kind) {
      case "Literal": return e.value;
      case "Grouping": return this.evaluate(e.expr);
      case "Variable": return this.variable(e);
      case "Assign": {
        const value = await this.evaluate(e.value);
        const d = this.locals.has(e) ? this.locals.get(e) : -1;
        if (d === -1) this.esc.globals.set(e.name.lexeme, value);
        else this.environment.assignAt(d, e.name.lexeme, value);
        return value;
      }
      case "Logical": {
        const left = await this.evaluate(e.left);
        if (e.op.type === T.OR) {
          if (isTruthy(left)) return left;
        } else if (!isTruthy(left)) return left;
        return this.evaluate(e.right);
      }
      case "Unary": {
        const right = await this.evaluate(e.right);
        if (e.op.type === T.BANG || e.op.type === T.NOT) return !isTruthy(right);
        if (e.op.type === T.MINUS) {
          if (!isNumber(right)) return this.error(`${e.op.lexeme}: Operand must be number.`), null;
          return -right;
        }
        return null;
      }
      case "Binary": return this.binary(e);
      case "Call": return this.call(e);
      case "InInventory": {
        let arg = await this.evaluate(e.id);
        if (arg && typeof arg === "object" && arg.globalId) arg = arg.globalId;
        return this.esc.inventory.has(arg);
      }
      case "Is": {
        let arg = await this.evaluate(e.id);
        if (typeof arg === "string") {
          // an id string only works for inventory items (Escoria looks those up)
          if (this.esc.inventory.has(arg)) arg = this.lookUpObjectById(arg);
        }
        if (!arg || typeof arg !== "object") {
          this.error(`'is' needs an object, got ${JSON.stringify(arg)}`);
          return false;
        }
        if (e.state) return arg.state === (await this.evaluate(e.state));
        return arg.active;
      }
    }
    this.error(`unknown expression ${e.kind}`);
    return null;
  }

  async binary(e) {
    const l = await this.evaluate(e.left);
    const r = await this.evaluate(e.right);
    const op = e.op;
    const nums = () => {
      if (isNumber(l) && isNumber(r)) return true;
      this.error(`${op.lexeme}: Operands must be numbers.`);
      return false;
    };
    switch (op.type) {
      case T.EQUAL_EQUAL: return isEqual(l, r);
      case T.BANG_EQUAL: return !isEqual(l, r);
      case T.GREATER: return nums() ? l > r : null;
      case T.GREATER_EQUAL: return nums() ? l >= r : null;
      case T.LESS: return nums() ? l < r : null;
      case T.LESS_EQUAL: return nums() ? l <= r : null;
      case T.MINUS: return nums() ? l - r : null;
      case T.STAR: return nums() ? l * r : null;
      case T.SLASH: return nums() ? l / r : null;
      case T.PLUS:
        if (isNumber(l) && isNumber(r)) return l + r;
        if (typeof l === "string" || typeof r === "string") return str(l) + str(r);
        this.error(`${op.lexeme}: Operands must be numbers or strings.`);
        return null;
    }
    return null;
  }

  variable(e) {
    const name = e.name.lexeme;
    if (name.startsWith("$")) return this.lookUpObject(name.slice(1));
    if (BUILTINS.includes(name)) return name;
    const d = this.locals.has(e) ? this.locals.get(e) : -1;
    if (d !== -1) return this.environment.getAt(d, name);
    // globals: commands first (they are defined in the same environment in Escoria)
    const cmd = this.esc.commands.get(name);
    if (cmd) return cmd;
    if (this.esc.globals.has(name)) return this.esc.globals.get(name);
    if (RESERVED_OBJECTS.includes(name)) return name;
    this.esc.log(`${e.name.file}: line ${e.name.line}: Undefined variable '${name}'.`, "error");
    return null;
  }

  lookUpObject(id) {
    if (id.toUpperCase() === CURRENT_PLAYER) id = this.esc.player ? this.esc.player.globalId : id;
    else if (id.toUpperCase() === CURRENT_OBJECT) {
      id = (this.currentEvent && this.currentEvent.objectGlobalId) || this.esc.roomId;
    }
    return this.lookUpObjectById(id);
  }

  lookUpObjectById(id) {
    const obj = this.esc.objects.get(id);
    if (obj) return obj;
    if (this.esc.roomObject && this.esc.roomObject.globalId === id) return this.esc.roomObject;
    this.error(`Unable to resolve object with global ID '${id}'.`);
    return null;
  }

  async call(e) {
    const callee = await this.evaluate(e.callee);
    const args = [];
    for (const a of e.args) {
      let v = await this.evaluate(a);
      // ESC commands take global ids, not objects
      if (v && typeof v === "object" && v.globalId) v = v.globalId;
      args.push(v);
    }
    if (!callee || typeof callee !== "object" || !callee.isCommand) {
      if (callee === "print") {
        if (args.length !== 1) return this.error("'print' expects exactly one argument"), RC.ERROR;
        this.esc.log(String(args[0] ?? "nil"));
        return RC.OK;
      }
      const name = e.callee.kind === "Variable" ? e.callee.name.lexeme : "?";
      this.error(`${e.paren.file}: line ${e.paren.line}: '${name}' is not a valid command.`);
      return RC.ERROR;
    }
    if (this.currentEvent && this.currentEvent.interrupted) return RC.OK;
    const command = { name: callee.name, args, token: e.paren, channel: this.channel, impl: callee, interrupted: false };
    if (this.currentEvent) this.currentEvent.runningCommand = command;
    const rc = await this.esc.runCommand(command);
    if (this.currentEvent) this.currentEvent.runningCommand = null;
    return rc;
  }
}

export function interruptEvent(event) {
  event.interrupted = true;
  const cmd = event.runningCommand;
  if (cmd) {
    cmd.interrupted = true;
    if (cmd.impl && cmd.impl.interrupt) cmd.impl.interrupt(cmd);
  }
}

// GDScript ==, with Escoria's twist: any two "empty" values are equal
function isEqual(l, r) {
  if (isFalsy(l) && isFalsy(r)) return true;
  if (isFalsy(l)) return false;
  return l === r;
}

// GDScript str()
export function str(v) {
  if (v === null || v === undefined) return "<null>";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v);
}
