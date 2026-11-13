// The JS side of a game's changes to Escoria's addons, which GEJE brings
// (src/compat/): games are plain Godot projects and have nothing for GEJE.
//
// scumm2escoria writes what it patched for a game as project settings:
//
//   [scumm2escoria]
//   patches/inventory_verb=true
//   patches/pickup="pickup"
//   patches/background_channels=true
//
// Projects converted before those settings existed bring a js_ports/config.js
// instead (`export default {patches: {inventoryVerb, pickup, backgroundChannels}}`).
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
export const SCUMM2ESCORIA = path.join(here, "..", "src", "compat", "scumm2escoria.js");

const KEYS = { inventory_verb: "inventoryVerb", pickup: "pickup", background_channels: "backgroundChannels" };

// a project.godot section as {key: value} (values: bool, number or string)
function section(file, name) {
  if (!fs.existsSync(file)) return null;
  let inside = false, found = false;
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const h = line.match(/^\[(.+)\]\s*$/);
    if (h) { inside = h[1] === name; found ||= inside; continue; }
    const m = inside && line.match(/^([^=;]+)=(.*)$/);
    if (!m) continue;
    const raw = m[2].trim();
    out[m[1].trim()] = raw === "true" ? true : raw === "false" ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw.replace(/^"(.*)"$/, "$1");
  }
  return found ? out : null;
}

/**
 * The compat module a game needs and its config, or null.
 * @returns {Promise<{module: string, config: object} | null>}
 */
export async function gamePatches(root) {
  const s = section(path.join(root, "project.godot"), "scumm2escoria");
  if (s) {
    const patches = {};
    for (const [k, v] of Object.entries(s)) {
      const key = k.startsWith("patches/") && KEYS[k.slice(8)];
      if (key) patches[key] = v;
    }
    return { module: SCUMM2ESCORIA, config: { patches } };
  }
  const legacy = path.join(root, "js_ports", "config.js");
  if (fs.existsSync(legacy)) {
    const config = (await import("file://" + legacy + `?t=${Date.now()}`)).default || {};
    return { module: SCUMM2ESCORIA, config };
  }
  return null;
}
