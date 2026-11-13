# Changelog

## 1.1 — 2026-11-12

This version runs the **[Superfluous Returnz demo](https://github.com/joaquin-becerra/superfluous-returnz-demo)** (Godot 4.7 + Escoria), a game with its own scripted interface instead of one of Escoria's stock UIs. The whole prologue plays in the browser, from New game to the end screen.

### Games with their own UI

- **Scripted game scene** (`src/escoria/ui/scripted_ui.js`). When `escoria/ui/game_scene` has its own translated script (a game's `ESCGame`), the engine puts that scene under `/root` the way Godot does. It also feeds the scene Escoria's input events: `element_focused`, `left_click_on_item`, `left_click_on_bg` and the rest.
- **Bridge adapters:**
  - `ESCGame`;
  - `ESCInventory` and its buttons;
  - the action manager (`current_tool`);
  - `save_game` / `load_game`;
  - `set_game_paused`;
  - `rand_global`;
  - `Engine`, `ProjectSettings`, `get_viewport()`, `get_camera_2d()` and `get_first_node_in_group()`.
- **Dialog scenes whose scripts place and style the text themselves**: the position, font, size and outline come from theme overrides, and the script's own line breaks are kept.
- **Controls:**
  - `TextureButton` with every `stretch_mode`;
  - rounded corners (`corner_radius_*`);
  - `reset_size()`;
  - `AtlasTexture.new()`.
- **Automatic `change_scene` transitions**: out over the room that leaves, in before the next room's `:ready`, as `esc_room_manager.gd` does.

### Fixes

- **Characters animated with an `AnimationPlayer`** (no `AnimatedSprite2D`) now play their walk and idle animations and mirror their sprite.
- **Scene metadata** (`metadata/<key>`) is now read by `get_meta` / `has_meta` / `get_meta_list`.
- **`resource_path` / `resource_name` of loaded `.tres` files** are no longer empty, so `load()` + `animations = …` (a crouch) now works.
- **Arrays of sub-resources** (e.g. `ESCAnimationResource` idles) now reach the scripts as wrapped objects.
- **Packed arrays** (`PackedStringArray`…) now reach the scripts as real arrays, so `append()` and `has()` work.
- **`ESCItem` array exports** (`actions_requiring_target_object`, `combine_when_selected_action_is_in`) now default to `[]` instead of `null`.
- **Camera limits**: with empty `camera_limits`, a room larger than the screen now uses its background's size, so the camera follows the player.
- **Draw order**: CanvasLayers above the transition layer (an end text) are now drawn over the fade.

### Translator (gd2js) and tools

- The lexer supports multi-line lambdas inside brackets (`connect(func(): …)`).
- The parser fixes a ternary after a dedent.
- Translated classes are installed in the order they use each other: enums, constants and `preload`ed scripts.
- The export and compatibility tools treat `addons/` other than Escoria's (`escoria-*`) and the test frameworks as the game's own code, which gets translated.
- `tools/compare`: new walkthrough step kinds `pick`, `item`, `text`, `world` and `go`, a key to skip lines, and both probes can find any visible text. Includes the Superfluous Returnz walkthrough (`tools/walkthroughs/superfluous_returnz_demo.json`, 40 steps).

## 1.0 — 2026-11-10

First release:
- the engine and player;
- the GDScript → JS translator (`tools/gd2js`);
- the exporter and compatibility report;
- the comparison tool against Godot's web build.

It runs OpenQuest (generated and enhanced) and the Escoria demo game.
