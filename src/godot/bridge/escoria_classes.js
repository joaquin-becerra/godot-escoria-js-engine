// Escoria's classes for translated GDScript: the ones game scripts use
// (ESCItem, ESCAnimationPlayer, ESCWalkContext, ESCScript, the action
// manager's states) and the ones they extend, as adapters over the engine's
// own UI (which already is Escoria's, in JS):
//   ESCTooltip                   the sentence line (esc.hooks.ui.sentence)
//   escoria-dialog-simple floating.gd   floating speech (esc.hooks.ui.dialog)
//   escoria-dialog-simple chooser/simple.gd (ESCDialogOptionsChooser)
//                                the dialog chooser (esc.hooks.ui.chooser)
// A subclass overrides the methods Escoria calls (update_tooltip_text, say,
// _calculate_time_to_disappear, show_chooser...) and the engine uses what
// they leave in the node (text, size, position, the chooser's buttons).
import { GdNode, GdObject, baseClass, wrapperOf } from "./nodes.js";
import { Node } from "../scene.js";
import { gdObject } from "./object.js";
import { GdResource } from "./resources.js";
import { Vector2, Color, fromEngine, GLOBALS } from "./values.js";
import { STATE } from "../../escoria/actions.js";
import { startTalking, stopTalking } from "../../escoria/commands/core.js";
import { eventKey } from "../../escoria/ashes/compiler.js";
import { AnimPlayer } from "../animation_player.js";
import { globalTransform, multiply } from "../render.js";

export const FLOATING_SCENE = "res://addons/escoria-dialog-simple/types/floating.tscn";
export const FLOATING_SCRIPT = "res://addons/escoria-dialog-simple/types/floating.gd";
export const CHOOSER_SCENE = "res://addons/escoria-dialog-simple/chooser/simple.tscn";
export const CHOOSER_SCRIPT = "res://addons/escoria-dialog-simple/chooser/simple.gd";

const ACTION = Object.freeze({ BACKGROUND_CLICK: 0, ITEM_LEFT_CLICK: 1, ITEM_RIGHT_CLICK: 2, TRIGGER_IN: 3, TRIGGER_OUT: 4 });
const ACTION_STATES = ["AWAITING_VERB_OR_ITEM", "AWAITING_ITEM", "AWAITING_TARGET_ITEM", "AWAITING_VERB", "AWAITING_VERB_CONFIRMATION", "COMPLETED"];
const stripBBCode = (s) => String(s).replace(/\[[^\]]*\]/g, "");

export function makeEscoriaClasses(bridge) {
  const esc = bridge.esc;
  const game = esc.game;
  const wrap = (n) => GdNode.wrap(n, bridge);
  // the engine's object of a node
  const objectOfNode = (node) => {
    if (esc.player && esc.player.node === node) return esc.player;
    for (const o of esc.objects.values()) if (o.node === node) return o;
    return null;
  };

  // ---------------------------------------------------------------- items

  /** ESCAnimationPlayer: the item's AnimatedSprite2D or AnimationPlayer. */
  class ESCAnimationPlayer extends GdObject {
    static gdClass = "ESCAnimationPlayer";
    constructor(anim) {
      super();
      this.__anim = anim;
    }
    has_animation(name) { return !!this.__anim && this.__anim.has(String(name)); }
    play(name, backwards = false) { this.__anim?.play(String(name), backwards); }
    play_backwards(name) { this.play(name, true); }
    stop() { this.__anim?.stop(); }
    seek_end(name) { this.__anim?.seekEnd(String(name)); }
    is_playing() { return !!this.__anim && !!this.__anim.playing?.(); }
    get_animation() { return this.__anim?.current?.() ?? ""; }
    get current_animation() { return this.get_animation(); }
    get_animations() { return this.__anim?.names?.() ?? []; }
    get_length(name) { return this.__anim?.length?.(String(name)) ?? 0; }
    get animation_finished() { return this.signal("animation_finished"); }
  }

  /** ESCWalkContext(target_object, target_position, fast, dont_interact_on_arrival) */
  class ESCWalkContext extends GdObject {
    static gdClass = "ESCWalkContext";
    constructor(target_object = null, target_position = null, fast = false, dont_interact_on_arrival = false) {
      super();
      Object.assign(this, { target_object, target_position, fast: !!fast, dont_interact_on_arrival: !!dont_interact_on_arrival });
    }
  }

  // the parts of ESCItem / ESCPlayer (esc_item.gd) over the engine's object
  const ESCItemMixin = (Base) =>
    class extends Base {
      get __obj() { return objectOfNode(this.__node); }
      get_animation_player() {
        const o = this.__obj;
        return o && o.anim ? new ESCAnimationPlayer(o.anim) : null;
      }
      get animation_sprite() { const m = this.__obj?.movable; return m && m.sprite ? wrap(m.sprite) : null; }
      // _movable (esc_movable.gd): where it faces, if it walks
      get _movable() {
        const m = this.__obj?.movable;
        if (!m) return null;
        return {
          get last_dir() { return m.lastDir; },
          set last_dir(d) { m.lastDir = d; },
          get last_deg() { return m.lastAngle; },
          get is_mirrored() { return m.mirrored; },
          get walk_destination() { return m.path.length ? new Vector2(m.path.at(-1).x, m.path.at(-1).y) : null; },
        };
      }
      walk_to(pos, ctx = null) {
        const m = this.__obj?.movable;
        if (!m) return;
        m.walkTo({ x: pos.x, y: pos.y }, { fast: !!(ctx && ctx.fast) });
        m.arrived().then(() => this.signal("arrived").emit(ctx));
      }
      is_moving() { return !!this.__obj?.movable?.walking; }
      // update_idle(): the idle of the direction it faces (its `animations` may have changed: crouch)
      update_idle() {
        const m = this.__obj?.movable;
        if (!m) return;
        const a = this.__node.props.animations;
        const res = a && a.$res ? game.resource(a.$res) : a;
        if (res && res.props) m.anims = res.props;
        const idle = m.anims && m.anims.idles && m.anims.idles[m.lastDir ?? 0];
        if (!idle) return;
        m.play(idle.props.animation);
        m.mirrored = !!idle.props.mirrored;
      }
      set_direction(dir, wait = 0) { return this.__obj?.movable?.setDirection(dir, wait, esc); }
      stop_walking_now() { const m = this.__obj?.movable; if (m && m.walking) m.stop(m.position); }
      teleport(target) { const m = this.__obj?.movable; const p = target.global_position || target; if (m) m.teleportTo({ x: p.x, y: p.y }); }
      teleport_to(p) { this.__obj?.movable?.teleportTo({ x: p.x, y: p.y }); }
      start_talking() { const o = this.__obj; if (o) startTalking(o); }
      stop_talking() { const o = this.__obj; if (o) stopTalking(o); }
      get_interact_position() { const p = this.__obj?.interactPosition(); return p ? new Vector2(p.x, p.y) : this.global_position; }
      get arrived() { return this.signal("arrived"); }
      // as get(): the item's exported vars (props), with Escoria's defaults
      get dialog_color() { return fromEngine(this.__node.props.dialog_color) || new Color(1, 1, 1, 1); }
      set dialog_color(c) { this.__node.props.dialog_color = c ? { type: "Color", args: [c.r, c.g, c.b, c.a] } : null; }
      get custom_data() { return (this.__node.props.custom_data ||= {}); }
      // PackedStringArray exports (default []): the stored array, so append() sticks
      get actions_requiring_target_object() { return (this.__node.props.actions_requiring_target_object ||= { type: "PackedStringArray", args: [] }).args; }
      set actions_requiring_target_object(a) { this.__node.props.actions_requiring_target_object = { type: "PackedStringArray", args: [...(a || [])] }; }
      get combine_when_selected_action_is_in() { return (this.__node.props.combine_when_selected_action_is_in ||= { type: "PackedStringArray", args: [] }).args; }
      set combine_when_selected_action_is_in(a) { this.__node.props.combine_when_selected_action_is_in = { type: "PackedStringArray", args: [...(a || [])] }; }
    };
  const ESCItem = ESCItemMixin(baseClass("Area2D"));
  Object.defineProperty(ESCItem, "gdClass", { value: "ESCItem" });
  const ESCPlayer = class extends ESCItem {};
  Object.defineProperty(ESCPlayer, "gdClass", { value: "ESCPlayer" });
  // the engine nodes with Escoria's scripts get these classes (wrap)
  GdNode.scriptClasses = { esc_item: ESCItem, esc_player: ESCPlayer };

  // ---------------------------------------------------------------- scripts, events

  /** ESCScript: a compiled .esc / .ash with its events. */
  class ESCScript extends GdObject {
    static gdClass = "ESCScript";
    constructor(compiled = null) {
      super();
      this.__s = compiled || { events: new Map() };
    }
    get events() { return Object.fromEntries(this.__s.events); }
    get_event_with_target(name, target) { return this.__s.events.get(eventKey(name, target)) || null; }
    get_event(name) { return this.__s.events.get(name) || null; }
  }
  const escCompiler = {
    load_esc_file: (path) => new ESCScript(esc.compileScript(String(path))),
  };

  // ---------------------------------------------------------------- the action manager
  const ActionInputState = Object.freeze(Object.fromEntries(ACTION_STATES.map((s, i) => [s, i])));
  const objectWrapper = (o) => (o ? bridge.objectWrapper(o) : null);
  const actionManager = {
    ActionInputState,
    get current_action() { return esc.actions.currentAction || ""; },
    set current_action(a) { esc.actions.currentAction = a; },
    get current_target() { return objectWrapper(esc.actions.currentTarget); },
    get action_state() { return ActionInputState[esc.actions.state] ?? 0; },
    set action_state(v) { esc.actions.state = STATE[ACTION_STATES[v]] || esc.actions.state; },
    clear_current_action: () => esc.actions.clearCurrentAction?.(),
    clear_current_tool: () => esc.actions.clearCurrentTool?.(),
    ACTION,
    set_current_action: (a) => esc.actions.setCurrentAction(String(a ?? "")),
    set_action_input_state: (v) => esc.actions.setState(STATE[ACTION_STATES[v]] || esc.actions.state),
    is_object_actionable: (id) => { const o = esc.getObject(id); return !!o && o.active && o.interactive; },
    /**
     * do(action, params, can_interrupt): BACKGROUND_CLICK [walker id,
     * Vector2 or object id, fast], ITEM_LEFT_CLICK / ITEM_RIGHT_CLICK [id,
     * InputEvent] (right: the item's default action)
     */
    do(action, params = [], canInterrupt = false) {
      const am = esc.actions;
      const toEvent = (ev) => ({ position: ev && ev.position ? { x: ev.position.x, y: ev.position.y } : null, doubleClick: !!(ev && (ev.double_click ?? ev.doubleClick)) });
      switch (action) {
        case ACTION.BACKGROUND_CLICK: {
          const t = params[1];
          return am.backgroundClick(params[0], typeof t === "string" ? t : { x: t.x, y: t.y }, !!params[2], !!canInterrupt);
        }
        case ACTION.ITEM_LEFT_CLICK:
          return am.itemClick(params[0], toEvent(params[1]), !!canInterrupt);
        case ACTION.ITEM_RIGHT_CLICK: {
          if (esc.state !== "DEFAULT") return;
          if (canInterrupt) esc.events.interrupt([], false);
          const o = esc.getObject(params[0]);
          return o ? am.performInputEventOnObject(o, toEvent(params[1]), true) : undefined;
        }
        default:
          esc.log(`action_manager.do(${action}): triggers aren't done this way here`, "warn");
      }
    },
  };
  // current_tool = <object>: the engine's object of that id
  Object.defineProperty(actionManager, "current_tool", {
    get: () => objectWrapper(esc.actions.currentTool),
    set: (o) => (esc.actions.currentTool = o ? esc.getObject(o.global_id) : null),
  });
  const ESCActionManager = { ActionInputState, ACTION };

  // ---------------------------------------------------------------- ESCTooltip: the sentence line

  /**
   * ESCTooltip (a RichTextLabel): the engine's sentence line asks the script
   * for its text. The fields Escoria keeps up to date (current_action,
   * current_target...) are set before update_tooltip_text(); `text` (bbcode)
   * is what is shown.
   */
  class ESCTooltip extends baseClass("RichTextLabel") {
    static gdClass = "ESCTooltip";
    constructor(...a) {
      super(...a);
      this.__field("current_action", "");
      this.__field("current_target", "");
      this.__field("current_prep", "with ");
      this.__field("current_target2", "");
      this.__field("waiting_for_target2", false);
    }
    get color() { return fromEngine(this.__node.props.color) || new Color(1, 1, 1, 1); }
    set color(c) { this.__node.props.color = { type: "Color", args: [c.r, c.g, c.b, c.a] }; }
    _ready() {
      const ui = (esc.hooks.ui ||= {});
      ui.sentence = (gui) => {
        this.current_action = esc.actions.currentAction || "";
        this.current_target = gui.target || "";
        this.current_target2 = gui.target2 || "";
        this.waiting_for_target2 = !!gui.waitingTarget2;
        this.update_tooltip_text();
        gui.waitingTarget2 = !!this.waiting_for_target2;
        gui.target2 = this.current_target2;
        return stripBBCode(this.text ?? "");
      };
    }
    set_target(t, needs2 = false) { this.current_target = t; this.waiting_for_target2 = needs2; this.update_tooltip_text(); }
    set_target2(t) { this.current_target2 = t; this.update_tooltip_text(); }
    clear() { this.current_target = ""; this.current_target2 = ""; this.waiting_for_target2 = false; this.update_tooltip_text(); }
    // what Escoria's own tooltip shows (9-verbs: "verb target [with target2]")
    update_tooltip_text() {
      const tr = (s) => game.tr(s);
      const parts = [tr(this.current_action), tr(this.current_target)];
      if (this.waiting_for_target2 || this.current_target2) parts.push(tr(this.current_prep.trim()));
      parts.push(tr(this.current_target2));
      this.text = parts.filter(Boolean).join(" ");
    }
    update_size() {}
  }

  // ---------------------------------------------------------------- floating speech

  /**
   * escoria-dialog-simple's floating.gd: say(character, line) sets the text
   * and where it goes (dialog_location_node); the line shows whole (no typing
   * effect), so _on_dialog_line_typed follows at once and
   * _calculate_time_to_disappear() is how long it stays; then
   * _on_dialog_finished(). A subclass that sets `size` / `position` places it.
   */
  class FloatingDialog extends baseClass("RichTextLabel") {
    static gdClass = "RichTextLabel";
    constructor(...a) {
      super(...a);
      this.__field("dialog_location_node", null);
      this.__field("_current_character", null);
      this.__field("_current_line", "");
      this.__field("_text_timing_finished", false);
      this.__field("_waiting_for_voice_audio", false);
      this.__field("_reading_speed_in_wpm", game.setting("escoria/dialog_simple/reading_speed_in_wpm", 200));
      this.__field("text_node", null);
      this.__field("_is_speeding_up", false);
      this.__field("is_paused", false);
      // floating.gd's Tween3 types the line; the engine shows it whole
      this.__field("tween", gdObject({ reset() {}, interpolate_property() {}, play() {}, stop() {}, resume() {}, is_running: () => false }));
    }
    get say_finished() { return this.signal("say_finished"); }
    get say_visible() { return this.signal("say_visible"); }
    _ready() {
      this.text_node = this;
      this.__node.props.bbcode_enabled = true;
    }
    say(character, line) {
      this._current_line = line;
      this._text_timing_finished = false;
      this.show();
      const obj = esc.player && esc.player.globalId === character ? esc.player : esc.getObject(character);
      this._current_character = obj ? wrap(obj.node) : null;
      this.dialog_location_node = null;
      if (obj) for (const c of obj.node.children) if (c.scriptName === "esc_dialog_location") this.dialog_location_node = wrap(c);
      const col = this._current_character ? this._current_character.dialog_color : new Color(1, 1, 1, 1);
      this.text = `[center][color=#${col.to_html(false)}]${this.tr(line)}[/color][center]`;
      // the engine places it unless the script does (size.x / position)
      this.__node.props.offset_left = this.__node.props.offset_right = 0;
      this.__node.state.placedByScript = false;
      this._current_character?.start_talking();
    }
    get_parsed_text() { return stripBBCode(this.text ?? ""); }
    get_text() { return this.get_parsed_text(); }
    speedup() {}
    finish() {}
    voice_audio_finished() { this._stop_character_talking(); }
    _should_stop_talking_when_text_finishes() { return true; }
    _on_dialog_line_typed() {
      if (this._should_stop_talking_when_text_finishes()) this._stop_character_talking();
      this.signal("say_visible").emit();
    }
    _calculate_time_to_disappear() {
      const words = this.get_parsed_text().split(/\s+/).filter(Boolean).length;
      return (words / this._reading_speed_in_wpm) * 60;
    }
    _on_dialog_finished() {
      this._text_timing_finished = true;
      this.hide();
      this.signal("say_finished").emit();
    }
    _stop_character_talking() { this._current_character?.stop_talking(); }
    _account_for_margin_x() {}
    _account_for_margin_y() {}
  }

  // ---------------------------------------------------------------- the dialog chooser

  /** ESCDialogOptionsChooser: `dialog` (options with is_valid()), show_chooser / hide_chooser, option_chosen. */
  class ESCDialogOptionsChooser extends baseClass("Control") {
    static gdClass = "ESCDialogOptionsChooser";
    constructor(...a) {
      super(...a);
      this.__field("dialog", null);
    }
    get option_chosen() { return this.signal("option_chosen"); }
    set_dialog(d) { this.dialog = d; }
    show_chooser() {}
    hide_chooser() {}
  }

  /**
   * dialog-simple's chooser/simple.gd: a button per option in its
   * VBoxContainer; the engine draws and clicks them (they are Controls of the
   * scene, on the screen root).
   */
  class SimpleChooser extends ESCDialogOptionsChooser {
    constructor(...a) {
      super(...a);
      this.__field("color_normal", this.__export("color_normal", new Color(1, 1, 1, 1)));
      this.__field("color_hover", this.__export("color_hover", new Color(165, 42, 42, 1)));
      this.__field("_no_more_options", false);
    }
    _ready() { this.hide_chooser(); }
    show_chooser() {
      const vbox = this.get_node("MarginContainer/ScrollContainer/VBoxContainer");
      for (const c of vbox.get_children()) vbox.remove_child(c);
      for (const option of this.dialog.options) {
        if (!option.is_valid()) continue;
        const b = bridge.new_("Button");
        b.text = option.option;
        b.flat = true;
        b.add_theme_color_override("font_color", this.color_normal);
        b.add_theme_color_override("font_hover_color", this.color_hover);
        vbox.add_child(b);
        b.pressed.connect(bridge.Callable(this, "_on_answer_selected").bind(option));
      }
      if (vbox.get_child_count() === 0) {
        this._no_more_options = true;
        this.get_node("Timer").start(0.05);
        return;
      }
      this.get_node("MarginContainer").show();
    }
    hide_chooser() { this.get_node("MarginContainer")?.hide(); }
    _option_chosen(option) { this.signal("option_chosen").emit(option); }
    _on_answer_selected(option) { this._option_chosen(option); }
    _on_Timer_timeout() {
      const chosen = this._no_more_options ? null : this.dialog.get_timeout_option();
      this._no_more_options = false;
      this._option_chosen(chosen);
    }
    _remove_avatar() {}
  }

  // ---------------------------------------------------------------- markers for `is`

  /** ESCDialogLocation (esc_dialog_location.gd): where speech goes; only `is` asks for it. */
  const ESCDialogLocation = class extends baseClass("Marker2D") {};
  Object.defineProperty(ESCDialogLocation, "gdClass", { value: "ESCDialogLocation" });
  /** ESCDialogOption: the chooser's options (the engine makes them; `as` / `is` only). */
  class ESCDialogOption extends GdObject {
    static gdClass = "ESCDialogOption";
  }

  // ---------------------------------------------------------------- ESCGame: a game's own UI

  /**
   * ESCGame (esc_game.gd), the base of a game scene's script: Escoria calls
   * its methods (ui/scripted_ui.js does here: element_focused,
   * left_click_on_item, left_click_on_bg, inventory_item_focused...); these
   * are the defaults a game's script doesn't override.
   */
  class ESCGame extends baseClass("Node2D") {
    static gdClass = "ESCGame";
    get main_menu() { return this.__export("main_menu", ""); }
    get pause_menu() { return this.__export("pause_menu", ""); }
    get tooltip_node() { return null; }
    initialize_esc_game() {}
    left_click_on_bg() {}
    right_click_on_bg() {}
    left_double_click_on_bg() {}
    hovered_bg() {}
    element_focused() {}
    element_unfocused() {}
    left_click_on_item() {}
    right_click_on_item() {}
    left_double_click_on_item() {}
    left_click_on_inventory_item() {}
    right_click_on_inventory_item() {}
    left_double_click_on_inventory_item() {}
    inventory_item_focused() {}
    inventory_item_unfocused() {}
    open_inventory() {}
    close_inventory() {}
    mousewheel_action() {}
    hide_ui() {}
    show_ui() {}
    hide_main_menu() {}
    show_main_menu() {}
    pause_game() {}
    unpause_game() {}
    apply_custom_settings() {}
    get_custom_data() { return {}; }
    _on_event_done() {}
    _on_action_finished() {}
  }

  // ---------------------------------------------------------------- the inventory (ESCInventory)

  // the game scene's script (escoria.main.current_scene.game)
  const gameScript = () => esc.hooks.gameScript?.() || null;

  /**
   * ESCInventoryButton (esc_inventory_button.gd): a TextureButton with the
   * item's inventory textures; the mouse on it goes to the game's script
   * (the inputs manager's part: inventory_item_focused, left_click_on_inventory_item...).
   */
  class ESCInventoryButton extends baseClass("TextureButton") {
    static gdClass = "ESCInventoryButton";
    constructor(item) {
      super(new Node("ESCInventoryButton", "TextureButton"), bridge);
      this.__field("global_id", item ? item.global_id : "");
      if (item) {
        this.texture_normal = item.texture_normal;
        this.texture_hover = item.texture_hovered;
      }
      this.__node.props.stretch_mode = 4; // STRETCH_KEEP_ASPECT
      const size = game.setting("escoria/ui/inventory_item_size", null);
      if (size && size.args) {
        this.__node.props.custom_minimum_size = { type: "Vector2", args: [size.args[0], size.args[1]] };
        this.__node.props.ignore_texture_size = true;
      }
      this.mouse_entered.connect(bridge.Callable(this, "_on_inventory_item_mouse_enter"));
      this.mouse_exited.connect(bridge.Callable(this, "_on_inventory_item_mouse_exit"));
      this.gui_input.connect(bridge.Callable(this, "_on_inventory_item_gui_input"));
    }
    get mouse_left_inventory_item() { return this.signal("mouse_left_inventory_item"); }
    get mouse_right_inventory_item() { return this.signal("mouse_right_inventory_item"); }
    get mouse_double_left_inventory_item() { return this.signal("mouse_double_left_inventory_item"); }
    get inventory_item_focused() { return this.signal("inventory_item_focused"); }
    get inventory_item_unfocused() { return this.signal("inventory_item_unfocused"); }
    _on_inventory_item_gui_input(event) {
      if (!event || !event.is_pressed || !event.is_pressed() || event.button_index === undefined) return;
      const id = this.global_id, g = gameScript();
      if (event.button_index === 4 || event.button_index === 5) {
        g?.mousewheel_action(event.button_index === 4 ? -1 : 1);
        return bridge.viewport.set_input_as_handled();
      }
      const all = esc.inputMode === "ALL";
      if (event.double_click) {
        if (event.button_index === 1) {
          this.signal("mouse_double_left_inventory_item").emit(id, event);
          if (all) g?.left_double_click_on_inventory_item(id, event);
        } else if (event.button_index === 2) {
          this.signal("mouse_right_inventory_item").emit(id, event);
          if (all) g?.right_click_on_inventory_item(id, event);
        }
        return;
      }
      if (event.button_index === 1) {
        this.signal("mouse_left_inventory_item").emit(id, event);
        g?.left_click_on_inventory_item(id, event);
      } else if (event.button_index === 2) {
        this.signal("mouse_right_inventory_item").emit(id, event);
        if (all) g?.right_click_on_inventory_item(id, event);
      }
    }
    _on_inventory_item_mouse_enter() {
      this.signal("inventory_item_focused").emit(this.global_id);
      gameScript()?.inventory_item_focused(this.global_id);
    }
    _on_inventory_item_mouse_exit() {
      this.signal("inventory_item_unfocused").emit();
      gameScript()?.inventory_item_unfocused();
    }
  }

  /** ESCInventoryContainer (esc_inventory_container.gd): the node the buttons go in. */
  class ESCInventoryContainer extends baseClass("Control") {
    static gdClass = "ESCInventoryContainer";
    is_empty() { return this.get_child_count() > 0; }
    add_item(item) {
      const b = new ESCInventoryButton(item);
      this.add_child(b);
      return b;
    }
    remove_item(item) {
      for (const c of this.get_children()) {
        if (c instanceof ESCInventoryButton && c.global_id === item.global_id) {
          this.remove_child(c);
          c.queue_free();
        }
      }
    }
    get_inventory_button(item) {
      return this.get_children().find((c) => c.global_id === item.global_id) || null;
    }
  }

  /**
   * ESCInventory (inventory_ui.gd of escoria-core): keeps a button per item
   * of the inventory in `inventory_ui_container` (the engine's inventory is
   * globals i/<id>: it follows them each frame).
   */
  class ESCInventory extends baseClass("Control") {
    static gdClass = "ESCInventory";
    constructor(...a) {
      super(...a);
      this.__field("items_ids_in_inventory", {});
    }
    get inventory_ui_container() { return this.__export("inventory_ui_container", ""); }
    _ready() {
      if (!String(this.inventory_ui_container)) return esc.log("Inventory items container is empty.", "error");
      this.__sync();
      if (!this.__ticking) {
        this.__ticking = true;
        esc.tickers.push(() => !this.__freed && this.__sync());
      }
    }
    __sync() {
      const have = esc.inventory.items();
      for (const id of Object.keys(this.items_ids_in_inventory)) if (!have.includes(id)) this.remove_item_by_id(id);
      for (const id of have) if (!(id in this.items_ids_in_inventory)) this.add_new_item_by_id(id);
    }
    add_new_item_by_id(id) {
      id = String(id).replace(/^i\//, "");
      if (id in this.items_ids_in_inventory) return;
      const o = esc.inventoryObject(id);
      if (!o) return;
      const p = o.node.props;
      const item = gdObject({ global_id: id, texture_normal: GdResourceOf(p.inventory_texture), texture_hovered: GdResourceOf(p.inventory_texture_hovered || p.inventory_texture) });
      const container = this.get_node(this.inventory_ui_container);
      container.add_item(item);
      this.items_ids_in_inventory[id] = item;
    }
    remove_item_by_id(id) {
      const item = this.items_ids_in_inventory[id];
      if (!item) return;
      this.get_node(this.inventory_ui_container).remove_item(item);
      delete this.items_ids_in_inventory[id];
    }
    clear() {
      for (const id of Object.keys(this.items_ids_in_inventory)) this.remove_item_by_id(id);
    }
  }
  const GdResourceOf = (r) => (r ? GdResource.wrap(r, bridge) : null);
  // nodes with these Escoria scripts get these classes
  Object.assign(GdNode.scriptClasses, { esc_dialog_location: ESCDialogLocation, esc_inventory_container: ESCInventoryContainer });

  // ---------------------------------------------------------------- the engine uses them

  // the script of a scene's root, if the game changed it (the converter does) and it is translated
  const gameScriptOf = (scene, stock) => {
    const doc = game.files[scene];
    const root = doc && doc.kind === "scene" && doc.nodes[0];
    const s = root && root.props && root.props.script && root.props.script.$res;
    return s && s !== stock && esc.nodeScripts[s] ? s : null;
  };
  // one instance per scene, made the first time; like esc_dialog_simple.gd it is
  // in the tree only while it is used (add_child / remove_child of the dialog
  // player): a chooser left there would take every click (a full-screen Control)
  const instanceOf = (scene) => {
    const cache = (bridge.uiInstances ||= {});
    if (!cache[scene]) {
      const w = bridge.instantiate(scene);
      // in Godot it hangs from the game UI's dialog player and takes its theme (the speech font)
      if (!w.__node.props.theme && esc.dialogTheme) w.__node.props.theme = esc.dialogTheme;
      cache[scene] = w;
    }
    return cache[scene];
  };
  const enter = (w) => {
    if (w.__node.parent === esc.screenRoot) return;
    esc.screenRoot.add(w.__node);
    bridge.enterTree(w.__node); // _ready only the first time
  };
  const leave = (w) => {
    if (w.__node.parent) w.__node.parent.remove(w.__node);
  };
  const ui = (esc.hooks.ui ||= {});
  // speech: the floating dialog scene's script
  ui.dialog = {
    active: () => !!gameScriptOf(FLOATING_SCENE, FLOATING_SCRIPT),
    say(obj, text) {
      const d = instanceOf(FLOATING_SCENE);
      enter(d);
      d.say(obj.globalId, text);
      d._on_dialog_line_typed("", "");
      return { secs: d._calculate_time_to_disappear(), dialog: d };
    },
    // the width the script gave it, or null. Where it goes is floating.gd's
    // _process: centered on the dialog position each frame, kept on the
    // screen (_account_for_margin_x / _y), which the engine does
    layout(sp) {
      const d = sp.dialog;
      const w = d && d.size.x;
      if (!(w > 0)) return null;
      const n = d.__node;
      // a script that places it itself (sets position) and styles it (theme overrides)
      const own = n.props["theme_override_fonts/normal_font"] ? n.props : null;
      return {
        w,
        props: own,
        text: own ? stripBBCode(d.text ?? "") : null,
        pos: own && n.state.placedByScript ? d.position : null,
        // the height the text takes (fit_content): what the script's next placement uses
        setHeight: (h) => { if (own && Math.abs(d.size.y - h) > 0.5) d.size = new Vector2(w, h); },
      };
    },
    finished(sp) {
      if (!sp.dialog) return;
      // the script may have ended it itself (a key that skips the line)
      if (!sp.dialog._text_timing_finished) sp.dialog._on_dialog_finished();
      leave(sp.dialog);
    },
    /** did the script end the line itself? */
    ended: (sp) => !!(sp.dialog && sp.dialog._text_timing_finished),
  };
  // the chooser: the chooser scene's script; resolves with the chosen engine option
  ui.chooser = {
    active: () => !!gameScriptOf(CHOOSER_SCENE, CHOOSER_SCRIPT),
    show(dialog, choose) {
      const c = instanceOf(CHOOSER_SCENE);
      const options = dialog.options.map((o) => gdObject({ option: o.text, __o: o, is_valid: () => true }));
      c.dialog = gdObject({
        options, timeout: dialog.timeout || 0, avatar: dialog.avatar || "-",
        get_timeout_option: () => (dialog.timeoutOption ? options[dialog.timeoutOption - 1] || null : null),
      });
      const f = (opt) => {
        c.option_chosen.disconnect(f);
        c.hide_chooser();
        leave(c);
        choose(opt ? opt.__o : null);
      };
      c.option_chosen.connect(f);
      enter(c);
      c.show();
      c.show_chooser();
    },
  };

  bridge.scriptBases = { [FLOATING_SCRIPT]: FloatingDialog, [CHOOSER_SCRIPT]: SimpleChooser };
  return {
    classes: { ESCItem, ESCPlayer, ESCAnimationPlayer, ESCWalkContext, ESCScript, ESCActionManager, ESCTooltip, ESCDialogOptionsChooser, ESCDialogLocation, ESCDialogOption, ESCGame, ESCInventory, ESCInventoryButton, ESCInventoryContainer },
    escoria: { esc_compiler: escCompiler, action_manager: actionManager },
  };
}

/** Names the adapters define (for the translator's report). */
export const ESCORIA_CLASS_NAMES = ["ESCItem", "ESCPlayer", "ESCAnimationPlayer", "ESCWalkContext", "ESCScript", "ESCActionManager", "ESCTooltip", "ESCDialogOptionsChooser", "ESCDialogLocation", "ESCDialogOption", "ESCGame", "ESCInventory", "ESCInventoryButton", "ESCInventoryContainer"];
export const ESCORIA_SCRIPTS = [FLOATING_SCRIPT, CHOOSER_SCRIPT];
