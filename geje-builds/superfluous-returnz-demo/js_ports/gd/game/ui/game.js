// Translated from res://game/ui/game.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const InventoryUI = gd.preload("res://game/ui/inventory/inventory_ui.gd");
  const VERB_WALK = "walk";
  const VERB_COMBINE = "combine";
  const DEFAULT_LABELS = { "look": "Look", "move": "Move", "take": "Pick up", "inventory": "Inventory", "use": "Use", "combine": "Combine with" };
  const State = Object.freeze({ IDLE: 0, ACTION_CHOICE: 1, OBJECT_CHOICE: 2, INVENTORY_ACTION_CHOICE: 3 });
  class game extends gd.base("ESCGame") {
    constructor(...args) {
      super(...args);
      this.__field("_state", gd.member(State, "IDLE"));
      this.__field("_choice_target", "");
      this.__field("_choice_event", null);
      this.__field("_source_item", "");
      this.__field("_highlighted", null);
      this.__field("_highlight_material", null);
      this.__field("sosage", null);
      this.__field("inventory_ui", null);
    }
    __onready() {
      this.sosage = this.get_node("sosage");
      this.inventory_ui = this.get_node("ui/inventory_ui");
    }
    _ready() {
      this.hide_ui();
      call(gd.member(this.sosage, "choice_made"), "connect", gd.Callable(this, "_on_choice_made"));
      let shader = gd.new_("Shader", []);
      shader.code = op.add(op.add("shader_type canvas_item;\n", "void fragment() { vec4 c = texture(TEXTURE, UV) * COLOR;\n"), "COLOR = vec4(mix(c.rgb, vec3(1.0), 0.5), c.a); }");
      this._highlight_material = gd.new_("ShaderMaterial", []);
      this._highlight_material.shader = shader;
    }
    _enter_tree() {
      this.initialize_esc_game();
      let room_selector_parent = this.get_node("ui/HBoxContainer/VBoxContainer");
      if (truthy((truthy(gd.cls("ESCProjectSettingsManager").get_setting(gd.member(gd.cls("ESCProjectSettingsManager"), "ENABLE_ROOM_SELECTOR"))) && truthy(op.eq(call(room_selector_parent, "get_node_or_null", "room_select"), null))))) {
        call(room_selector_parent, "add_child", call(gd.preload(op.add("res://addons/escoria-core/ui_library/tools/room_select", "/room_select.tscn")), "instantiate"));
      }
    }
    _process(_delta) {
      this._update_inventory_mode();
    }
    _update_inventory_mode() {
      if (truthy(!truthy(gd.member(this.get_node("ui/inventory_ui"), "visible")))) {
        return;
      }
      let interactive = (truthy(op.ne(gd.member(gd.member(gd.escoria, "inputs_manager"), "input_mode"), gd.member(gd.member(gd.escoria, "inputs_manager"), "INPUT_NONE"))) && truthy(op.eq(gd.member(gd.escoria, "current_state"), gd.member(gd.member(gd.escoria, "GameState"), "DEFAULT"))));
      if (truthy(!truthy(interactive))) {
        if (truthy(op.eq(this._state, gd.member(State, "IDLE")))) {
          call(this.inventory_ui, "set_mode", gd.member(gd.member(InventoryUI, "Mode"), "HIDDEN"));
        }
        return;
      }
      let p = call(this.sosage, "mouse_position");
      {
        const __m1 = this._state;
        if (op.eq(__m1, gd.member(State, "IDLE"))) {
          let bottom = (truthy((gd.member(p, "y") > op.sub(gd.member(gd.member(gd.cls("SosageInterface"), "WORLD"), "y"), op.div(gd.member(InventoryUI, "ACTIVE_ZONE"), 5)))) || truthy(((truthy((gd.member(p, "y") > op.sub(gd.member(gd.member(gd.cls("SosageInterface"), "WORLD"), "y"), gd.member(InventoryUI, "ACTIVE_ZONE")))) && truthy((gd.member(p, "x") < call(this.inventory_ui, "tab_width")))))));
          if (truthy(call(this.inventory_ui, "is_open"))) {
            if (truthy((gd.member(p, "y") < call(this.inventory_ui, "open_top")))) {
              call(this.inventory_ui, "set_mode", gd.member(gd.member(InventoryUI, "Mode"), "TAB"));
            }
          } else if (truthy(bottom)) {
            call(this.inventory_ui, "set_mode", gd.member(gd.member(InventoryUI, "Mode"), "OPEN"));
          } else {
            call(this.inventory_ui, "set_mode", gd.member(gd.member(InventoryUI, "Mode"), "TAB"));
          }
        }
        else if (op.eq(__m1, gd.member(State, "OBJECT_CHOICE")) || op.eq(__m1, gd.member(State, "INVENTORY_ACTION_CHOICE"))) {
          call(this.inventory_ui, "set_mode", gd.member(gd.member(InventoryUI, "Mode"), "OPEN"));
        }
        else if (op.eq(__m1, gd.member(State, "ACTION_CHOICE"))) {
          call(this.inventory_ui, "set_mode", gd.member(gd.member(InventoryUI, "Mode"), "TAB"));
        }
      }
    }
    left_click_on_bg(position) {
      if (truthy(op.eq(this._state, gd.member(State, "OBJECT_CHOICE")))) {
        this._back_to_idle();
        return;
      }
      if (truthy(op.ne(this._source_item, ""))) {
        this._clear_source();
        return;
      }
      if (truthy(gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "player"))) {
        gd.member(gd.escoria, "action_manager").clear_current_action();
        gd.member(gd.escoria, "action_manager").do(gd.member(gd.member(gd.member(gd.escoria, "action_manager"), "ACTION"), "BACKGROUND_CLICK"), [gd.member(gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "player"), "global_id"), position], true);
      }
    }
    right_click_on_bg(_position) {

    }
    left_double_click_on_bg(position) {
      if (truthy((truthy(op.ne(this._source_item, "")) || truthy(op.ne(this._state, gd.member(State, "IDLE")))))) {
        return;
      }
      if (truthy(gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "player"))) {
        gd.member(gd.escoria, "action_manager").clear_current_action();
        gd.member(gd.escoria, "action_manager").do(gd.member(gd.member(gd.member(gd.escoria, "action_manager"), "ACTION"), "BACKGROUND_CLICK"), [gd.member(gd.member(gd.member(gd.member(gd.escoria, "main"), "current_scene"), "player"), "global_id"), position, true], true);
      }
    }
    element_focused(element_id) {
      if (truthy(op.ne(this._state, gd.member(State, "IDLE")))) {
        return;
      }
      let obj = gd.member(gd.escoria, "object_manager").get_object(element_id);
      if (truthy((truthy(op.eq(obj, null)) || truthy(!truthy(gd.is(gd.member(obj, "node"), "ESCItem")))))) {
        return;
      }
      let item = gd.member(obj, "node");
      this._set_highlight(item);
      if (truthy((truthy(gd.member(item, "is_exit")) && truthy(op.eq(this._source_item, ""))))) {
        let dir = this._exit_direction(item);
        call(this.sosage, "set_cursor", dir);
        call(this.sosage, "show_cursor_label", this.tr(gd.member(item, "tooltip_name")), dir);
      } else {
        if (truthy(op.eq(this._source_item, ""))) {
          call(this.sosage, "set_cursor", "object");
        }
        call(this.sosage, "show_cursor_label", this.tr(gd.member(item, "tooltip_name")), "object");
      }
    }
    element_unfocused() {
      this._set_highlight(null);
      if (truthy(op.eq(this._state, gd.member(State, "IDLE")))) {
        call(this.sosage, "clear_label");
        if (truthy(op.eq(this._source_item, ""))) {
          call(this.sosage, "set_cursor", "default");
        }
      }
    }
    left_click_on_item(item_global_id, event) {
      if (truthy(op.eq(this._state, gd.member(State, "OBJECT_CHOICE")))) {
        this._back_to_idle();
        return;
      }
      if (truthy(op.ne(this._state, gd.member(State, "IDLE")))) {
        return;
      }
      let obj = gd.member(gd.escoria, "object_manager").get_object(item_global_id);
      if (truthy(op.eq(obj, null))) {
        return;
      }
      let item = gd.member(obj, "node");
      if (truthy(op.ne(this._source_item, ""))) {
        let source = this._source_item;
        this._clear_source();
        this._combine(source, item_global_id, event);
        return;
      }
      if (truthy((truthy(gd.is(item, "ESCItem")) && truthy(gd.member(item, "is_exit"))))) {
        gd.member(gd.escoria, "action_manager").clear_current_action();
        gd.member(gd.escoria, "action_manager").do(gd.member(gd.member(gd.member(gd.escoria, "action_manager"), "ACTION"), "ITEM_LEFT_CLICK"), [item_global_id, event], true);
        return;
      }
      this._choice_target = item_global_id;
      this._choice_event = event;
      this._state = gd.member(State, "ACTION_CHOICE");
      this._set_highlight(null);
      call(this.sosage, "set_cursor", "default");
      call(this.sosage, "open_selector", call(this.sosage, "mouse_position"), [["take", this._verb_label(item, "take"), "left"], ["look", this._verb_label(item, "look"), "right"], ["move", this._verb_label(item, "move"), "up"], ["inventory", this._verb_label(item, "inventory"), "down"]]);
    }
    right_click_on_item(_item_global_id, _event) {

    }
    left_double_click_on_item(item_global_id, event) {
      this.left_click_on_item(item_global_id, event);
    }
    left_click_on_inventory_item(inventory_item_global_id, event) {
      let id = inventory_item_global_id;
      if (truthy(op.eq(this._state, gd.member(State, "OBJECT_CHOICE")))) {
        let target = this._choice_target;
        let target_event = this._choice_event;
        this._back_to_idle();
        this._combine(id, target, target_event);
        return;
      }
      if (truthy(op.ne(this._state, gd.member(State, "IDLE")))) {
        return;
      }
      if (truthy(op.ne(this._source_item, ""))) {
        if (truthy(op.eq(this._source_item, id))) {
          return;
        }
        let source = this._source_item;
        this._clear_source();
        this._combine(source, id, event);
        return;
      }
      let button = call(this.inventory_ui, "get_button", id);
      let item = gd.member(gd.member(gd.escoria, "object_manager").get_object(id), "node");
      this._choice_target = id;
      this._choice_event = event;
      this._state = gd.member(State, "INVENTORY_ACTION_CHOICE");
      call(this.sosage, "clear_label");
      let point = G.Vector2((truthy(button) ? gd.member(call(call(button, "get_global_rect"), "get_center"), "x") : gd.member(call(this.sosage, "mouse_position"), "x")), op.sub(call(this.inventory_ui, "open_top"), op.mul(0.75, gd.member(gd.cls("SosageLabel"), "HEIGHT"))));
      call(this.sosage, "open_selector", point, [["combine", this._verb_label(item, "combine"), "left"], ["look", this._verb_label(item, "look"), "right"], ["use", this._verb_label(item, "use"), "up"]]);
    }
    right_click_on_inventory_item(_inventory_item_global_id, _event) {

    }
    left_double_click_on_inventory_item(_inventory_item_global_id, _event) {

    }
    inventory_item_focused(inventory_item_global_id) {
      if (truthy((truthy(op.ne(this._state, gd.member(State, "IDLE"))) && truthy(op.ne(this._state, gd.member(State, "OBJECT_CHOICE")))))) {
        return;
      }
      if (truthy(op.eq(inventory_item_global_id, this._source_item))) {
        return;
      }
      let item = gd.member(gd.member(gd.escoria, "object_manager").get_object(inventory_item_global_id), "node");
      call(this.inventory_ui, "set_item_active", inventory_item_global_id, true);
      let button = call(this.inventory_ui, "get_button", inventory_item_global_id);
      if (truthy(button)) {
        let center = G.Vector2(gd.member(call(call(button, "get_global_rect"), "get_center"), "x"), op.sub(call(this.inventory_ui, "open_top"), op.mul(2, gd.member(InventoryUI, "LABEL_MARGIN"))));
        call(this.sosage, "show_fixed_label", this.tr(gd.member(item, "tooltip_name")), center);
      }
    }
    inventory_item_unfocused() {
      for (let id of iter(gd.member(gd.escoria, "inventory_manager").items_in_inventory())) {
        call(this.inventory_ui, "set_item_active", id, false);
      }
      if (truthy((truthy(op.eq(this._state, gd.member(State, "IDLE"))) || truthy(op.eq(this._state, gd.member(State, "OBJECT_CHOICE")))))) {
        call(this.sosage, "clear_label");
      }
    }
    open_inventory() {
      call(this.inventory_ui, "set_mode", gd.member(gd.member(InventoryUI, "Mode"), "OPEN"));
    }
    close_inventory() {
      call(this.inventory_ui, "set_mode", gd.member(gd.member(InventoryUI, "Mode"), "TAB"));
    }
    mousewheel_action(_direction) {

    }
    async _on_choice_made(choice) {
      let target = this._choice_target;
      let event = this._choice_event;
      let was_inventory = op.eq(this._state, gd.member(State, "INVENTORY_ACTION_CHOICE"));
      this._state = gd.member(State, "IDLE");
      this._choice_target = "";
      this._choice_event = null;
      {
        const __m1 = choice;
        if (op.eq(__m1, "")) {
        }
        else if (op.eq(__m1, "inventory")) {
          this._state = gd.member(State, "OBJECT_CHOICE");
          this._choice_target = target;
          this._choice_event = event;
        }
        else if (op.eq(__m1, "combine")) {
          this._source_item = target;
          let item = gd.member(gd.member(gd.escoria, "object_manager").get_object(target), "node");
          call(this.sosage, "set_cursor", "selected", this._inventory_texture(item));
          call(this.inventory_ui, "set_mode", gd.member(gd.member(InventoryUI, "Mode"), "TAB"));
        }
        else if (true) {
          gd.member(gd.escoria, "logger").info(this, op.mod("Sosage UI: '%s' on '%s'.", [choice, target]));
          if (truthy(!truthy((await this._wait_for_default_state())))) {
            return;
          }
          gd.member(gd.escoria, "action_manager").clear_current_action();
          gd.member(gd.escoria, "action_manager").set_current_action(choice);
          gd.member(gd.escoria, "action_manager").do(gd.member(gd.member(gd.member(gd.escoria, "action_manager"), "ACTION"), "ITEM_LEFT_CLICK"), [target, event], true);
          if (truthy(was_inventory)) {
            call(this.inventory_ui, "set_mode", gd.member(gd.member(InventoryUI, "Mode"), "TAB"));
          }
        }
      }
    }
    async _combine(tool_id, target_id, event) {
      let am = gd.member(gd.escoria, "action_manager");
      let tool = gd.member(gd.escoria, "object_manager").get_object(tool_id);
      if (truthy((truthy(op.eq(tool, null)) || truthy(!truthy(gd.member(gd.escoria, "object_manager").has(target_id)))))) {
        return;
      }
      if (truthy(!truthy(op.in(VERB_COMBINE, gd.member(gd.member(tool, "node"), "actions_requiring_target_object"))))) {
        call(gd.member(gd.member(tool, "node"), "actions_requiring_target_object"), "append", VERB_COMBINE);
      }
      gd.member(gd.escoria, "logger").info(this, op.mod("Sosage UI: combine '%s' with '%s'.", [tool_id, target_id]));
      if (truthy(!truthy((await this._wait_for_default_state())))) {
        return;
      }
      call(am, "clear_current_action");
      call(am, "set_current_action", VERB_COMBINE);
      am.current_tool = tool;
      call(am, "set_action_input_state", gd.member(gd.member(am, "ActionInputState"), "AWAITING_TARGET_ITEM"));
      call(am, "do", gd.member(gd.member(am, "ACTION"), "ITEM_LEFT_CLICK"), [target_id, event], true);
      call(this.inventory_ui, "set_mode", gd.member(gd.member(InventoryUI, "Mode"), "TAB"));
    }
    async _wait_for_default_state(timeout = 15.0) {
      let waited = 0.0;
      while (truthy(op.ne(gd.member(gd.escoria, "current_state"), gd.member(gd.member(gd.escoria, "GameState"), "DEFAULT")))) {
        (await gd.member(this.get_tree(), "process_frame"));
        waited = op.add(waited, this.get_process_delta_time());
        if (truthy((waited > timeout))) {
          gd.member(gd.escoria, "logger").warn(this, "Sosage UI: action dropped, Escoria stayed busy.");
          return false;
        }
      }
      return true;
    }
    _back_to_idle() {
      this._state = gd.member(State, "IDLE");
      this._choice_target = "";
      this._choice_event = null;
      call(this.sosage, "close_selector");
      call(this.sosage, "clear_label");
    }
    _clear_source() {
      this._source_item = "";
      call(this.sosage, "set_cursor", "default");
    }
    _verb_label(item, verb) {
      if (truthy(op.eq(item, null))) {
        return this.tr(op.get(DEFAULT_LABELS, verb));
      }
      let labels = call(item, "get_meta", "verb_labels", {  });
      let by_state = call(item, "get_meta", "verb_labels_by_state", {  });
      if (truthy((truthy((truthy(!truthy(call(by_state, "is_empty"))) && truthy(op.in("global_id", item)))) && truthy(gd.member(gd.escoria, "object_manager").has(gd.member(item, "global_id")))))) {
        let state = gd.member(gd.member(gd.escoria, "object_manager").get_object(gd.member(item, "global_id")), "state");
        if (truthy((truthy(call(by_state, "has", state)) && truthy(call(op.get(by_state, state), "has", verb))))) {
          return this.tr(op.get(op.get(by_state, state), verb));
        }
      }
      return this.tr(call(labels, "get", verb, op.get(DEFAULT_LABELS, verb)));
    }
    _exit_direction(item) {
      if (truthy(call(item, "has_meta", "goto"))) {
        return (truthy(op.eq(call(item, "get_meta", "goto"), "right")) ? "goto_right" : "goto_left");
      }
      if (truthy(call(gd.member(item, "global_id"), "contains", "_r_"))) {
        return "goto_right";
      }
      if (truthy(call(gd.member(item, "global_id"), "contains", "_l_"))) {
        return "goto_left";
      }
      let x = gd.member(gd.member(call(item, "get_global_transform_with_canvas"), "origin"), "x");
      return (truthy((x > op.div(gd.member(gd.member(gd.cls("SosageInterface"), "WORLD"), "x"), 2))) ? "goto_right" : "goto_left");
    }
    _inventory_texture(item) {
      if (truthy((truthy(gd.is(item, "ESCItem")) && truthy(gd.member(item, "inventory_texture"))))) {
        return gd.member(item, "inventory_texture");
      }
      if (truthy(gd.is(item, "TextureButton"))) {
        return gd.member(item, "texture_normal");
      }
      return null;
    }
    _set_highlight(item) {
      if (truthy(G.is_instance_valid(this._highlighted))) {
        this._highlighted.material = null;
      }
      this._highlighted = null;
      if (truthy(op.eq(item, null))) {
        return;
      }
      for (let c of iter(call(item, "get_children"))) {
        if (truthy((truthy((truthy(gd.is(c, "Sprite2D")) && truthy(op.ne(gd.member(c, "texture"), null)))) && truthy(gd.member(c, "visible"))))) {
          c.material = this._highlight_material;
          this._highlighted = c;
          return;
        }
      }
    }
    hide_ui() {
      this.get_node("ui/inventory_ui").visible = false;
      this.get_node("ui/HBoxContainer/VBoxContainer").visible = false;
      call(this.sosage, "clear_label");
      call(this.sosage, "close_selector");
    }
    show_ui() {
      this.get_node("ui/inventory_ui").visible = true;
      this.get_node("ui/HBoxContainer/VBoxContainer").visible = true;
    }
    hide_main_menu() {
      this.show_ui();
      if (truthy(gd.member(this.get_node(gd.member(this, "main_menu")), "visible"))) {
        call(this.get_node(gd.member(this, "main_menu")), "hide");
      }
    }
    show_main_menu() {
      this.hide_ui();
      if (truthy(!truthy(gd.member(this.get_node(gd.member(this, "main_menu")), "visible")))) {
        call(this.get_node(gd.member(this, "main_menu")), "reset");
        call(this.get_node(gd.member(this, "main_menu")), "show");
      }
    }
    unpause_game() {
      if (truthy(gd.member(this.get_node(gd.member(this, "pause_menu")), "visible"))) {
        call(this.get_node(gd.member(this, "pause_menu")), "hide");
        gd.member(gd.member(gd.escoria, "object_manager").get_object(gd.member(gd.cls("ESCObjectManager"), "SPEECH")), "node").resume();
        this.show_ui();
        gd.escoria.set_game_paused(false);
      }
    }
    pause_game() {
      if (truthy(!truthy(gd.member(this.get_node(gd.member(this, "pause_menu")), "visible")))) {
        this.hide_ui();
        this._back_to_idle();
        this._clear_source();
        call(this.get_node(gd.member(this, "pause_menu")), "reset");
        call(this.get_node(gd.member(this, "pause_menu")), "show");
        gd.member(gd.member(gd.escoria, "object_manager").get_object(gd.member(gd.cls("ESCObjectManager"), "SPEECH")), "node").pause();
        gd.escoria.set_game_paused(true);
      }
    }
    apply_custom_settings(custom_settings) {
      if (truthy(call(custom_settings, "has", "a_custom_setting"))) {
        gd.member(gd.escoria, "logger").info(this, op.mod("custom setting value loaded: %s.", G.str(op.get(custom_settings, "a_custom_setting"))));
      }
    }
    get_custom_data() {
      return { "ui_type": "simplemouse" };
    }
    _on_action_finished() {

    }
    _on_event_done(_return_code, _event_name) {
      if (truthy(op.eq(_return_code, gd.member(gd.cls("ESCExecution"), "RC_OK")))) {
        gd.member(gd.escoria, "action_manager").clear_current_action();
      }
    }
  }
  Object.assign(game, { InventoryUI, VERB_WALK, VERB_COMBINE, DEFAULT_LABELS, State });
  return game;
}
