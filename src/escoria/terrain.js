// ESCTerrain (esc_terrain.gd): the walkable area of a room (its
// NavigationRegion2D children) and the scale of characters by position.
import { NavMesh } from "../godot/navigation.js";
import { globalTransform } from "../godot/render.js";
import { color } from "../godot/values.js";

export class Terrain {
  constructor(game, node) {
    this.game = game;
    this.node = node;
    this.build();
    this.scaleMin = node.props.scale_min ?? 0.3;
    this.scaleMax = node.props.scale_max ?? 1.0;
    this.speedMultiplier = node.props.player_speed_multiplier ?? 1.0;
    this.fastMultiplier = node.props.player_doubleclick_speed_multiplier ?? 1.5;
    this.scales = pixels(game, node.props.scales); // ImageData of the `scales` texture, if any
    this.lightmap = pixels(game, node.props.lightmap); // the `lightmap` texture, if any
    this.lightmapModulate = color(node.props.lightmap_modulate);
  }

  // the enabled NavigationRegion2D (current_active_navigation_instance) and its mesh
  build() {
    const regions = [];
    this.active = null;
    for (const n of this.node.walk()) {
      if (n.type === "NavigationRegion2D" && n.props.enabled !== false && n.props.navigation_polygon) {
        this.active ||= n;
        regions.push({ xf: globalTransform(n), polygon: n.props.navigation_polygon });
      }
    }
    this.nav = new NavMesh(regions);
  }

  /** enable_terrain: the child `name` becomes the only enabled region. False if it doesn't exist. */
  enable(name) {
    const n = this.node.getNode(name);
    if (!n) return false;
    if (this.active) this.active.props.enabled = false;
    n.props.enabled = true;
    this.build();
    return true;
  }

  /** get_terrain(): brightness (HSV value) of the scales image at pos, or 1. */
  factor(pos) {
    const s = this.scales;
    if (!s) return 1.0;
    const x = Math.min(Math.max(Math.floor(pos.x), 0), s.width - 1);
    const y = Math.min(Math.max(Math.floor(pos.y), 0), s.height - 1);
    const i = (y * s.width + x) * 4;
    return Math.max(s.data[i], s.data[i + 1], s.data[i + 2]) / 255;
  }

  /** get_light(): the lightmap's color at pos times lightmap_modulate (white without one). */
  lightAt(pos) {
    const s = this.lightmap, m = this.lightmapModulate;
    if (!s) return { type: "Color", args: [1, 1, 1, 1] };
    const x = Math.min(Math.max(Math.floor(pos.x), 0), s.width - 1);
    const y = Math.min(Math.max(Math.floor(pos.y), 0), s.height - 1);
    const i = (y * s.width + x) * 4, d = s.data;
    return { type: "Color", args: [(d[i] / 255) * m.r, (d[i + 1] / 255) * m.g, (d[i + 2] / 255) * m.b, (d[i + 3] / 255) * m.a] };
  }

  /** get_scale_range() */
  scaleAt(pos) {
    return this.scaleMin + (this.scaleMax - this.scaleMin) * this.factor(pos);
  }

  path(from, to) {
    return this.nav.path(from, to);
  }
}

// the pixels of a texture prop ({$res}), or null
function pixels(game, tex) {
  const img = tex && game.image(tex.$res);
  if (!img) return null;
  try {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const cx = c.getContext("2d");
    cx.drawImage(img, 0, 0);
    return cx.getImageData(0, 0, img.width, img.height);
  } catch {
    return null;
  }
}

/** The room's terrain: the first ESCTerrain that has a navigation region. */
export function findTerrain(game, room) {
  for (const n of room.walk()) {
    if (n.scriptName === "esc_terrain") {
      const t = new Terrain(game, n);
      if (!t.nav.empty) return t;
    }
  }
  return null;
}
