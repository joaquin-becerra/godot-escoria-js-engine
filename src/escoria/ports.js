// Game ports: the JS versions of a game's own GDScript files (commands,
// autoloads, scripts of room nodes) and of its patches to Escoria live with the
// game, not in the engine. The exporter writes them (tools/gd2js translates the
// GDScript) and game.json says where their entry is (`ports`); this loads it.
//
// A port module exports:
//   handles: [".gd paths it covers"]       (the exporter warns about the rest)
//   install(esc, api): registers commands (esc.addCommands), node scripts
//     (esc.nodeScripts), autoloads and classes (through the bridge), key
//     handlers (esc.keyHandlers), commands that only set state (esc.stateCommands).
//   A game that patched Escoria's addons brings the JS side of its patches
//   through hooks named after the function it changed: esc.hooks.objectManagerHas
//   (esc_object_manager.gd has), esc.hooks.combinationFallback and
//   esc.actions.beforeEvent (esc_action_manager.gd), esc.hooks.inventoryLeftClick
//   (9-verbs game.gd), AnimPlayer.stopPauses (esc_animation_player.gd stop).
// and gets the engine's pieces through `api` (no imports of engine files).
import { AnimPlayer } from "../godot/animation_player.js";
import { createBridge } from "../godot/bridge/index.js";

export const API = Object.freeze({
  AnimPlayer,
  /** The GDScript bridge for translated scripts (tools/gd2js), one per runtime. */
  bridge: (esc) => (esc.__bridge ||= createBridge(esc)),
});

/** Loads and installs the game's ports, if it has any. Returns the module or null. */
export async function loadPorts(esc) {
  const entry = esc.game.json.ports;
  if (!entry) return null;
  const url = new URL(esc.game.base + entry, location.href).href;
  const mod = await import(url);
  await mod.install(esc, API);
  esc.portHandles = new Set(mod.handles || []); // covered by the ports their own way (no "not ported" warnings)
  esc.log(`game ports: ${entry} (${(mod.handles || []).length} scripts)`);
  return mod;
}
