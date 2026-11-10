// Scene tree: instancing exported .tscn files into Node objects.
//
// Like Godot's PackedScene.instantiate(): nodes are created in file order;
// a node with `instance` is a whole sub-scene; a node without `type` whose
// parent is inside an instanced sub-scene only overrides properties of a node
// that already exists there.

export class Node {
  constructor(name, type) {
    this.name = name;
    this.type = type || "Node";
    this.props = {};
    this.children = [];
    this.parent = null;
    this.groups = [];
    this.sceneFile = null; // set on the root of every instanced scene
    this.state = {}; // runtime state (current animation frame, etc.)
  }

  get script() {
    return this.props.script && this.props.script.$res ? this.props.script.$res : null;
  }

  /** The script's file name without extension: "esc_item", "esc_player"... */
  get scriptName() {
    const s = this.script;
    return s ? s.slice(s.lastIndexOf("/") + 1).replace(/\.gd$/, "") : "";
  }

  add(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
  }

  /** Relative path like Godot's get_node(): "a/b", "..", "../x". */
  getNode(path) {
    if (path === "" || path === ".") return this;
    let n = this;
    for (const part of path.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") n = n.parent;
      else n = n && n.children.find((c) => c.name === part);
      if (!n) return null;
    }
    return n;
  }

  /** Path from `ancestor` (or the tree root) to this node. */
  pathFrom(ancestor = null) {
    const parts = [];
    for (let n = this; n && n !== ancestor; n = n.parent) parts.unshift(n.name);
    return parts.join("/");
  }

  *walk() {
    yield this;
    for (const c of this.children) yield* c.walk();
  }

  find(pred) {
    for (const n of this.walk()) if (pred(n)) return n;
    return null;
  }
}

/** Instances an exported scene. */
export function instantiate(game, file) {
  const doc = game.files[file];
  if (!doc || doc.kind !== "scene") throw new Error(`not an exported scene: ${file}`);
  const subs = new Map();
  const byPath = new Map(); // path relative to the root -> node
  let root = null;
  for (const n of doc.nodes) {
    const isRoot = n.parent === undefined;
    const parent = isRoot ? null : n.parent === "." ? root : byPath.get(n.parent);
    const path = isRoot ? "." : n.parent === "." ? n.name : `${n.parent}/${n.name}`;
    if (!isRoot && !parent) {
      console.warn(`${file}: parent not found for ${path}`);
      continue;
    }
    let node;
    if (n.instance) {
      node = instantiate(game, n.instance);
      node.name = n.name;
    } else if (!n.type && !isRoot) {
      // override of a node that comes from an instanced sub-scene
      node = parent.children.find((c) => c.name === n.name);
      if (!node) {
        console.warn(`${file}: ${path} overrides a node that doesn't exist`);
        continue;
      }
    } else {
      node = new Node(n.name, n.type);
    }
    Object.assign(node.props, game.resolve(n.props, file, subs));
    // Godot 3's AnimatedSprite.frames, which Godot 4 still takes as sprite_frames
    if (node.type === "AnimatedSprite2D" && node.props.frames && typeof node.props.frames === "object" && !node.props.sprite_frames) {
      node.props.sprite_frames = node.props.frames;
      delete node.props.frames;
    }
    if (n.groups) node.groups.push(...n.groups);
    if (isRoot) root = node;
    else if (node.parent !== parent) parent.add(node);
    byPath.set(path, node);
  }
  root.sceneFile = file;
  // [connection] signal="pressed" from="a/b" to="." method="_on_x": resolved to nodes
  if (doc.connections) {
    const at = (p) => (p === "." || p === "" ? root : root.getNode(p));
    root.connections = doc.connections
      .map((c) => ({ signal: c.signal, from: at(c.from), to: at(c.to), method: c.method, binds: c.binds || null, flags: c.flags || 0 }))
      .filter((c) => c.from && c.to);
  }
  return root;
}
