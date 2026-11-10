// An Escoria room ready to show: the room scene plus the player, placed the
// way ESCRoom does it (esc_room.gd: player_scene at the start location).
import { instantiate } from "../godot/scene.js";
import { globalTransform, apply } from "../godot/render.js";
import { rect2 } from "../godot/values.js";

/** Exported scenes whose root is an ESCRoom: [{file, id}] */
export function listRooms(game) {
  const out = [];
  for (const [file, doc] of Object.entries(game.files)) {
    if (doc.kind !== "scene") continue;
    const root = doc.nodes[0];
    if (root && root.props.script && /esc_room\.gd$/.test(root.props.script.$res)) out.push({ file, id: root.props.global_id || file });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ESCExit extends ESCItem
export const isItem = (n) => ["esc_item", "esc_player", "esc_exit"].includes(n.scriptName);

export async function loadRoom(game, file) {
  const room = instantiate(game, file);
  let player = null;
  if (room.props.player_scene) {
    player = instantiate(game, room.props.player_scene.$res);
    const start = room.find((n) => n.scriptName === "esc_location" && n.props.is_start_location);
    if (start) {
      const p = apply(globalTransform(start), { x: 0, y: 0 });
      player.props.position = { type: "Vector2", args: [p.x, p.y] };
    }
    room.add(player);
  }
  // ESCMovable.update_terrain(): movable items are drawn by their y
  for (const n of room.walk()) {
    if (isItem(n) && n.props.is_movable && !n.props.is_exit) {
      const p = apply(globalTransform(n), { x: 0, y: 0 });
      n.props.z_index = Math.min(Math.round(p.y), 4096);
    }
  }
  await game.loadImagesIn(room.props);
  for (const n of room.walk()) await game.loadImagesIn(n.props);
  // esc_room.gd: camera_limits defaults to [Rect2()] (the viewport at 0,0)
  const limits = (room.props.camera_limits || [{ type: "Rect2", args: [0, 0, 0, 0] }]).map(rect2);
  return { room, player, limits };
}
