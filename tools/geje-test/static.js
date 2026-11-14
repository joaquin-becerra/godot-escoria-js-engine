// Static checks of an exported game (no running): its .esc scripts compile,
// tools/compat.js's verdict and list, and its animations:
//   - every ESCAnimationResource (characters: walk / idle / speak per
//     direction) names animations its AnimatedSprite2D / AnimationPlayer has
//   - every SpriteFrames animation has frames, a speed above 0 and textures
//     that were exported
//   - every AnimationPlayer track points at a node that exists
// Returns {verdict, issues: [{level: "error"|"warn", kind, where, msg}]}.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const engineDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const imp = (f) => import(pathToFileURL(path.join(engineDir, f)).href);

export async function staticChecks(name) {
  const gameDir = path.join(engineDir, "geje-builds", name);
  const json = JSON.parse(fs.readFileSync(path.join(gameDir, "game.json"), "utf8"));
  const issues = [];
  const seen = new Set();
  const add = (level, kind, where, msg) => {
    const k = `${kind}|${where}|${msg}`;
    if (seen.has(k)) return;
    seen.add(k);
    issues.push({ level, kind, where, msg });
  };

  // ---- .esc scripts
  const { compile } = await imp("src/escoria/ashes/compiler.js");
  for (const [file, src] of Object.entries(json.scripts || {})) {
    let s;
    try {
      s = compile(src, file);
    } catch (e) {
      add("error", "esc", file, `compiler crashed: ${e.message}`);
      continue;
    }
    for (const e of s.errors) add("error", "esc", file, String(e));
  }

  // ---- compat.js (writes COMPATIBILITY.txt as always)
  const r = spawnSync(process.execPath, [path.join(engineDir, "tools/compat.js"), gameDir], { encoding: "utf8" });
  const verdict = (/compatibility with the engine: (.+)/.exec(r.stdout || "") || [, "?"])[1].trim();
  for (const line of (r.stdout || "").split("\n")) {
    const m = /^\s*([✗△])\s+(.*)$/.exec(line);
    if (m) add(m[1] === "✗" ? "error" : "warn", "compat", "", m[2]);
  }
  if (r.status) add("error", "compat", "", `compat.js failed: ${(r.stderr || "").trim().split("\n").pop()}`);

  // ---- animations (the scenes as the engine instantiates them)
  globalThis.window ||= { addEventListener() {}, removeEventListener() {} };
  const { GameData } = await imp("src/godot/game_data.js");
  const { instantiate } = await imp("src/godot/scene.js");
  const { animations, tracks } = await imp("src/godot/animation.js");
  const { nodePath } = await imp("src/godot/values.js");
  const game = new GameData(pathToFileURL(gameDir + "/").href, json);
  const exported = new Set(json.assets || []);
  const imageExists = (res) => {
    const r2 = (json.remap && json.remap[res]) || res;
    return exported.has(res) || fs.existsSync(path.join(gameDir, "res", r2.slice(6)));
  };
  const imagesIn = (v, out = []) => {
    if (!v || typeof v !== "object") return out;
    if (Array.isArray(v)) v.forEach((x) => imagesIn(x, out));
    else {
      if (typeof v.$res === "string" && /\.(png|jpe?g|webp|svg)$/i.test(v.$res)) out.push(v.$res);
      for (const x of Object.values(v)) if (x && typeof x === "object") imagesIn(x, out);
    }
    return out;
  };
  const warnOrig = console.warn;
  console.warn = () => {}; // instantiate()'s notes about overrides: compat.js reports those
  for (const [file, doc] of Object.entries(json.files)) {
    if (doc.kind !== "scene") continue;
    let root;
    try {
      root = instantiate(game, file);
    } catch (e) {
      add("error", "scene", file, `can't be instantiated: ${e.message}`);
      continue;
    }
    for (const n of root.walk()) {
      const where = `${file}::${n.pathFrom(root) || "."}`;
      if (n.type === "AnimatedSprite2D") {
        const anims = n.props.sprite_frames?.props?.animations || [];
        if (n.props.sprite_frames && !anims.length) add("error", "anim", where, "SpriteFrames without animations");
        for (const a of anims) {
          if (!a.frames || !a.frames.length) add("error", "anim", where, `"${a.name}" has no frames`);
          if (!((a.speed ?? 5) > 0)) add("warn", "anim", where, `"${a.name}" speed ${a.speed}`);
          for (const res of imagesIn(a.frames)) if (!imageExists(res)) add("error", "anim", where, `"${a.name}": texture ${res} wasn't exported`);
        }
        const auto = n.props.autoplay || n.props.animation;
        if (auto && anims.length && !anims.some((a) => a.name === auto)) add("error", "anim", where, `animation/autoplay "${auto}" doesn't exist`);
      }
      if (n.type === "AnimationPlayer") {
        const anims = animations(n);
        const base = n.getNode(nodePath(n.props.root_node) || "..");
        for (const [an, anim] of Object.entries(anims)) {
          if (!anim || !anim.props) continue;
          for (const tr of tracks(anim)) {
            if (tr.enabled === false || !tr.path) continue;
            const p = nodePath(tr.path).split(":")[0];
            if (base && p && !base.getNode(p)) add("warn", "anim", where, `"${an}": track to ${p}, a node that doesn't exist`);
            for (const res of imagesIn(tr.keys)) if (!imageExists(res)) add("error", "anim", where, `"${an}": texture ${res} wasn't exported`);
          }
        }
        if (n.props.autoplay && !anims[n.props.autoplay]) add("error", "anim", where, `autoplay "${n.props.autoplay}" doesn't exist`);
      }
      // ESCAnimationResource: what Escoria plays to walk, stand and speak
      const ar = n.props.animations && n.props.animations.props;
      if (ar && (ar.directions || ar.idles || ar.speaks)) {
        const sprite = n.children.find((c) => c.type === "AnimatedSprite2D");
        const apPath = n.props.animation_player_node;
        const ap = !sprite && (apPath && apPath.args && apPath.args[0] ? n.getNode(apPath.args[0]) : [...n.children].reverse().find((c) => c.type === "AnimationPlayer"));
        const names = sprite ? (sprite.props.sprite_frames?.props?.animations || []).map((a) => a.name) : ap ? Object.keys(animations(ap)) : null;
        if (!names) {
          add("error", "anim", where, "has an animation resource but no AnimatedSprite2D / AnimationPlayer");
          continue;
        }
        const nDirs = (ar.dir_angles || []).length;
        for (const kind of ["directions", "idles", "speaks"]) {
          const list = ar[kind] || [];
          if (nDirs && list.length !== nDirs) add("warn", "anim", where, `${kind}: ${list.length} for ${nDirs} directions`);
          list.forEach((d, i) => {
            const an = d && d.props && d.props.animation;
            if (!an) add("warn", "anim", where, `${kind}[${i}] has no animation`);
            else if (!names.includes(an)) add("error", "anim", where, `${kind}[${i}]: "${an}" doesn't exist`);
          });
        }
      }
    }
  }
  console.warn = warnOrig;
  return { verdict, issues };
}
