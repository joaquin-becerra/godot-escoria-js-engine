# Changelog

## 1.2 — 2026-11-16

Sharper graphics, and games made for phones play on phones: GEJE now brings the JS side of the [Escoria Mobile](https://github.com/joaquin-becerra/escoria-mobile-addon) addon. OpenQuest Enhanced 1.1 is the first game that uses it.

### Player

- **Sharp picture.** The player's canvas now has the screen's real pixels (its size on the page × `devicePixelRatio`) and fills the window keeping the game's shape. The game still draws in its own units (e.g. 1280x800) through a base scale, like Godot's `canvas_items` stretch. Before, everything was drawn at the game size and the browser stretched the canvas: HD art was scaled twice and looked jagged and blurry next to Godot's web export. Every game gets it, with no new export.
- **`frame_post_draw` every frame.** The player and the headless test now emit it on every frame, as Godot does, even with no room on screen. OpenQuest Enhanced's start script waits for it before its first room, and the screen stayed black.
- **Esc skips a cutscene** in any game with a `cutscene_skip` autoload (OpenQuest Enhanced's), before the pause menu opens.

### Escoria Mobile, JS side

`src/compat/escoria_mobile/`: games that have the addon get the same touch support as in Godot, with the same `escoria/mobile/*` settings. Games without it play with the mouse as before.

- **Gestures**:
  - the first tap on an item shows it and the second tap acts;
  - a tap on the floor walks and a double tap runs;
  - a long press is a right click;
  - a drag moves the cursor, and a drag released on a button clicks it.
- **Phone layout** (`layout/room_height`, `layout/bottom_panel`):
  - the room fills the screen;
  - on phones the panel becomes a drawer that opens with a tab or with the first tap on an item, so you can tap the object first and then the verb;
  - on tablets the panel stays docked under the room;
  - menus come back in the full design;
  - a game's dialog chooser slides up over a translucent backdrop.
- **HUD**: a gear that opens the pause menu (like Esc) and a star that highlights the room's interactive items for a few seconds. Corner, size, colors and icons come from `hud_buttons/*` and `style/*`.
- **Web**: the first touch puts the page in fullscreen and locks it to landscape where the browser allows it. While the screen is in portrait, a "turn your phone" hint covers the game. Settings: `web/fullscreen_on_first_touch`, `web/landscape`.

### Engine

- **Verb buttons are hit-tested at the click's position** (`GameUI.clickPanel`). Before, the button under the mouse came from the last frame drawn, so a tap with no hover before it could pick another verb.
- **Games bring nothing for GEJE.** The JS side of a game's changes to Escoria's addons now lives in GEJE (`src/compat/scumm2escoria.js`), not in the game's `js_ports/`.
  - `tools/export.js` installs it for games made by scumm2escoria, which marks them with a `[scumm2escoria]` section in `project.godot`. That section also says what was patched for each game (`tools/game_patches.js`).
  - Games converted before this change still work through their `js_ports/config.js`.

### Tools

- **Faster rebuilds.** `tools/export.js` keeps every converted file (PNG to WebP, WAV to Ogg) in a cache, `~/.cache/geje/convert/` (or `$GEJE_CACHE/convert/`).
  - Each entry is named by a hash of the source file and the conversion settings, so a rebuild only converts new or changed files and copies the rest.
  - `--no-cache` converts everything again.
  - The export prints how many files were reused and how many were converted.

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
