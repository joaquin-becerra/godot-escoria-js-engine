// What the engine supports, for the compatibility report of the exporter
// (tools/compat.js). Things it can check by itself come from the engine's own
// code (the ESC commands from commands/core.js, the controls from
// godot/controls.js, the node properties it reads from the sources); the rest
// is declared here. When the engine learns a node type, a resource, an
// Escoria script or an event, add it here too.
//
// Each entry: true (supported) or a string (supported in part: what is
// missing). What is not listed is not supported.
import { CONTROL_TYPES, DRAWN_CONTROLS } from "./godot/controls.js";

const drawnControls = Object.fromEntries([...DRAWN_CONTROLS].map((t) => [t, true]));
const otherControls = Object.fromEntries([...CONTROL_TYPES].filter((t) => !DRAWN_CONTROLS.has(t)).map((t) => [t, true]));

/** Node types. */
export const NODES = {
  ...otherControls,
  ...drawnControls,
  TextureButton: "not drawn (only takes clicks)",
  Node: true, Node2D: true, CanvasLayer: true, Marker2D: true, Area2D: true,
  Sprite2D: true, AnimatedSprite2D: true, AnimationPlayer: true, Timer: true, AudioStreamPlayer: true,
  CollisionPolygon2D: true,
  CollisionShape2D: true, // the mouse only finds RectangleShape2D: tools/compat.js checks the shape
  NavigationRegion2D: true,
  Navigation2D: true, // Godot 3; the terrain only uses its NavigationRegion2D children
  Camera2D: true,
  Polygon2D: "no texture (color only)",
  Line2D: "no texture or gradient",
  GPUParticles2D: "on the CPU: no turbulence, attractors or collisions",
  ParallaxBackground: true, ParallaxLayer: true,
};

/**
 * Node types that never show anything nor do anything in a game (editor
 * helpers): not reported.
 */
export const HARMLESS_NODES = new Set(["ReferenceRect"]);

/** Resource types (sub_resources and .tres). */
export const RESOURCES = {
  Resource: true, // Escoria's own resources (esc_animationresource.gd...): their script says
  AtlasTexture: "only in Sprite2D and AnimatedSprite2D (not in controls)",
  AnimatedTexture: "only as a dialog_simple avatar",
  ParticleProcessMaterial: true, CurveTexture: true, GradientTexture1D: true, GradientTexture2D: true, // particles (src/godot/particles.js)
  SpriteFrames: true, Animation: true, AnimationLibrary: true, NavigationPolygon: true,
  RectangleShape2D: true, CircleShape2D: true, CapsuleShape2D: true, Theme: true, StyleBoxEmpty: true, StyleBoxFlat: true, StyleBoxTexture: true,
  FontFile: true, FontVariation: true, ShaderMaterial: true, Shader: true,
  // 3D / project-wide things a 2D game carries along and doesn't need
  Environment: true, Sky: true, AudioBusLayout: true,
};

/** Resource types that are only parts of others: reported with the one that uses them. */
export const PART_RESOURCES = new Set(["Gradient", "Curve"]);

/**
 * Escoria scripts on nodes that the engine reimplements (by file name; the
 * game's own scripts are translated by tools/gd2js). `whole`: the engine
 * draws that scene itself, so the nodes inside it are not checked.
 */
export const ESCORIA_SCRIPTS = {
  "addons/escoria-core/game/core-scripts/esc_room.gd": true,
  "addons/escoria-core/game/core-scripts/esc_item.gd": true,
  "addons/escoria-core/game/core-scripts/esc_player.gd": true,
  "addons/escoria-core/game/core-scripts/esc_exit.gd": true,
  "addons/escoria-core/game/core-scripts/esc_location.gd": true,
  // ESCBackground: its clicks are the room's (the game UI takes them)
  "addons/escoria-core/game/core-scripts/esc_background.gd": true,
  "addons/escoria-core/game/core-scripts/esc_dialog_location.gd": true,
  "addons/escoria-core/game/core-scripts/esc_interaction_location.gd": true,
  "addons/escoria-core/game/core-scripts/esc_terrain.gd": true,
  "addons/escoria-core/game/main_scene.gd": { whole: true },
  "addons/escoria-core/game/scenes/dialogs/esc_dialog_player.gd": true,
  "addons/escoria-core/game/scenes/inventory/inventory_ui.gd": true,
  "addons/escoria-core/ui_library/inventory/esc_inventory_container.gd": true,
  "addons/escoria-core/game/scenes/camera_player/esc_camera.gd": { whole: true },
  "addons/escoria-ui-keyboard-9verbs/game.gd": true,
  "addons/escoria-ui-keyboard-9verbs/verbs_menu.gd": true,
  // ui/simplemouse_ui.js
  "addons/escoria-ui-simplemouse/game.gd": true,
  "addons/escoria-ui-simplemouse/verbs_mouseicons.gd": true,
  "addons/escoria-ui-simplemouse/inventory/inventory_ui.gd": true,
  "addons/escoria-ui-simplemouse/tooltip/tooltip_target.gd": true,
  "addons/escoria-dialog-simple/types/floating.gd": { whole: true },
  "addons/escoria-dialog-simple/chooser/simple.gd": { whole: true },
  // Escoria's menus: ui/menus.js draws them
  "addons/escoria-core/ui_library/menus/main_menu/main_menu.gd": { whole: true },
  "addons/escoria-core/ui_library/menus/pause_menu/pause_menu.gd": { whole: true },
  "addons/escoria-core/ui_library/menus/options/options.gd": { whole: true },
  "addons/escoria-core/ui_library/menus/load_save/load/load_game.gd": { whole: true },
  "addons/escoria-core/ui_library/menus/load_save/save/save_game.gd": { whole: true },
  "addons/escoria-core/ui_library/menus/load_save/load_save_slot/load_save_slot.gd": { whole: true },
  "addons/escoria-core/ui_library/menus/load_save/save/save_name_popup.gd": { whole: true },
  "addons/escoria-core/ui_library/menus/load_save/save/overwrite_confirm_popup.gd": { whole: true },
};

/** Dialog managers (setting escoria/ui/dialog_managers). */
export const DIALOG_MANAGERS = new Set(["res://addons/escoria-dialog-simple/esc_dialog_simple.gd"]);

/** Transitions (setting escoria/ui/default_transition). */
export const TRANSITIONS = new Set(["instant", "fade_black", "fade_white", "curtain", "from_center", "shards"]);

/** ESC events the engine never sends (the feature that sends them is missing). */
export const EVENTS_NOT_SENT = {};

/**
 * Node properties that are only for the editor or for layout details that
 * don't change the game: not reported when the engine doesn't read them.
 */
export const IGNORED_PROPS = /^(__meta__|metadata\/|editor_|layout_mode$|anchors_preset$|grow_|unique_name_in_owner$|theme_override_constants\/|drag_)/;
