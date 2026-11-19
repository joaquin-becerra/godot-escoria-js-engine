// ESCMovable (behaviors/esc_movable.gd): walking along a path, choosing the
// walk / idle animation by direction, z_index by y, terrain scale and mirroring.
import { vec2 } from "../godot/values.js";
import { AnimPlayer } from "../godot/animation_player.js";

const Z_MAX = 4096; // RenderingServer.CANVAS_ITEM_Z_MAX

export class Movable {
  /** @param item ESCItem / ESCPlayer node; @param terrain Terrain or null */
  constructor(item, terrain) {
    this.item = item;
    this.terrain = terrain;
    this.anims = item.props.animations ? item.props.animations.props : null; // ESCAnimationResource
    this.sprite = item.children.find((c) => c.type === "AnimatedSprite2D") || null;
    // no AnimatedSprite2D: animations come from an AnimationPlayer (as
    // get_animation_player()) and get_sprite() is the last Sprite2D (mirroring)
    if (!this.sprite) {
      const path = item.props.animation_player_node;
      const ap = path && path.args && path.args[0] ? item.getNode(path.args[0]) : [...item.children].reverse().find((c) => c.type === "AnimationPlayer");
      this.animator = ap ? new AnimPlayer(ap) : null;
      this.sprite = [...item.children].reverse().find((c) => c.type === "Sprite2D") || null;
    } else this.animator = null;
    this.path = [];
    this.ofs = 0;
    this.walking = false;
    this.fast = false;
    this.lastAngle = 0;
    this.lastDir = this.initialDir();
    this.mirrored = false;
    this.scale = 1;
    this.onArrived = null;
    this.waiters = []; // promises waiting for the next arrival (ESCItem.arrived)
    this.updateTerrain();
  }

  /**
   * Resolves when the item stops walking (at once if it isn't walking) with
   * the walk context of the walk that ended: {target, position}, like
   * ESCItem's `arrived` signal.
   */
  arrived() {
    if (!this.walking) return Promise.resolve(this.context || { target: null, position: this.position });
    return new Promise((ok) => this.waiters.push(ok));
  }

  /** teleport_to() */
  teleportTo(p) {
    this.position = p;
    this.updateTerrain();
  }

  /** set_angle(): turn (through the directions in between) to face `deg`. */
  async setAngle(deg, wait = 0, esc = null) {
    return this.setDirection(this.dirForDegrees(deg), wait, esc);
  }

  /** set_direction() */
  async setDirection(target, wait = 0, esc = null) {
    const n = (this.anims && this.anims.dir_angles || []).length;
    if (!n) return;
    if (target < 0 || target >= n) target = 0;
    const cur = this.lastDir;
    let way = 0;
    if (cur !== target) {
      const internal = Math.max(cur, target) - Math.min(cur, target) < n / 2;
      way = (internal && cur < target) || (!internal && cur > target) ? 1 : -1;
    }
    let dir = cur;
    while (dir !== target) {
      dir += way;
      if (dir >= n) dir = 0;
      if (dir < 0) dir = n - 1;
      this.play(this.anims.idles[dir].props.animation);
      if (wait > 0 && esc) await esc.wait(wait);
      this.mirrored = !!this.anims.idles[dir].props.mirrored;
    }
    this.lastDir = dir;
    const idle = this.anims.idles[dir].props.animation;
    if (this.animator ? this.animator.current() !== idle : this.sprite && this.sprite.state.animation !== idle) this.play(idle);
    this.updateTerrain();
  }

  /** turn_to(): face another node. */
  async turnTo(node, wait = 0, esc = null) {
    const p = this.position, q = vec2(node.props.position);
    let deg = Math.trunc((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI);
    deg = ((deg % 360) + 360) % 360;
    return this.setAngle(deg, wait, esc);
  }

  get position() {
    return vec2(this.item.props.position);
  }

  set position(p) {
    this.item.props.position = { type: "Vector2", args: [p.x, p.y] };
  }

  // the direction whose idle animation is the one the sprite starts with
  initialDir() {
    if (!this.anims || !(this.animator || this.sprite)) return 0;
    const cur = this.animator ? this.animator.current() : this.sprite.props.autoplay || this.sprite.props.animation;
    const i = (this.anims.idles || []).findIndex((a) => a.props.animation === cur);
    return i >= 0 ? i : 0;
  }

  /**
   * walk_to(): starts walking to pos (the path ends at the closest walkable
   * point). `target`: the object node walked to (ESCWalkContext.target_object),
   * the walker faces its interaction_angle on arrival.
   */
  walkTo(pos, { fast = false, onArrived = null, target = null } = {}) {
    this.context = { target, position: { x: pos.x, y: pos.y } };
    if (!this.terrain) return this.stop(this.position);
    this.path = this.terrain.path(this.position, pos);
    this.fast = fast;
    this.onArrived = onArrived;
    if (!this.path.length) return this.stop(this.position);
    this.ofs = 0;
    this.walking = true;
  }

  /** _process() + _calculate_movement() */
  update(dt) {
    if (!this.walking) return;
    const pos = this.position;
    const next = this.path.length > 1 ? this.path[this.ofs + 1] : this.path[this.ofs];
    const a = Math.sin(this.lastAngle) ** 2;
    let speed = (this.item.props.speed ?? 300) * dt * this.scale * (a * this.scale + 1 - a) * (this.terrain ? this.terrain.speedMultiplier : 1);
    if (this.fast && this.terrain) speed *= this.terrain.fastMultiplier;
    const dx = next.x - pos.x, dy = next.y - pos.y;
    const d = Math.hypot(dx, dy);
    let np;
    if (d < speed || d === 0) {
      np = { x: next.x, y: next.y };
      this.ofs++;
    } else {
      const damp = this.item.props.v_speed_damp ?? 1;
      np = { x: pos.x + (dx / d) * speed * damp, y: pos.y + (dy / d) * speed * damp };
    }
    if (this.ofs >= this.path.length - 1) return this.stop(this.path[this.path.length - 1], this.context && this.context.target);
    this.position = np;
    // Godot 4 angle_to_point(): angle of (new - old)
    this.orient(Math.atan2(np.y - pos.y, np.x - pos.x));
    this.updateTerrain();
  }

  /** _perform_walk_orientation() */
  orient(angle) {
    this.lastAngle = angle;
    const dir = this.dirForDegrees(angle * (180 / Math.PI));
    if (dir < 0) return;
    this.lastDir = dir;
    const anim = this.anims.directions[dir];
    this.play(anim.props.animation);
    this.mirrored = !!anim.props.mirrored;
  }

  /** walk_stop(): idle in the last direction (or the target's interaction_angle). */
  stop(pos, target = null) {
    this.position = pos;
    this.path = [];
    this.walking = false;
    if (this.anims) {
      let dir = this.lastDir;
      // ESCItem / ESCLocation: player_orients_on_arrival (default true),
      // interaction_angle (default 0: up)
      const orients = target && ["esc_item", "esc_player", "esc_exit", "esc_location"].includes(target.scriptName);
      if (orients && target.props.player_orients_on_arrival !== false) {
        const d = this.dirForDegrees((target.props.interaction_angle ?? 0) - 90);
        dir = d >= 0 ? d : 0;
        this.lastDir = dir;
      }
      const idle = this.anims.idles[dir];
      if (idle) {
        this.play(idle.props.animation);
        this.mirrored = !!idle.props.mirrored;
      }
    }
    this.updateTerrain();
    const cb = this.onArrived;
    this.onArrived = null;
    if (cb) cb();
    const w = this.waiters;
    this.waiters = [];
    const ctx = this.context || { target: null, position: pos };
    w.forEach((f) => f(ctx));
  }

  /** _get_dir_deg(): index of the dir_angles interval that holds the angle. */
  dirForDegrees(deg) {
    if (!this.anims) return -1;
    deg = Math.trunc(deg); // the GDScript function takes an int
    deg = (((deg + 90) % 360) + 360) % 360; // wrapi(deg + 90, 0, 360)
    const angles = this.anims.dir_angles || [];
    for (let i = 0; i < angles.length; i++) {
      const start = angles[i].props.angle_start ?? 0;
      const end = start + (angles[i].props.angle_size ?? 0);
      const a = end > 360 && deg < start ? deg + 360 : deg;
      if (start <= a && a <= end) return i;
    }
    return -1;
  }

  play(name) {
    if (this.animator) {
      if (this.animator.current() === name && this.animator.isPlaying()) return;
      return this.animator.play(name);
    }
    const s = this.sprite;
    if (!s) return;
    if (s.state.animation === name && s.state.playing) return;
    s.state.animation = name;
    s.state.frame = 0;
    s.state.elapsed = 0;
    s.state.playing = true;
  }

  /** update_terrain(): z_index by y, scale from the terrain, mirrored sprite. */
  updateTerrain() {
    const item = this.item;
    if (item.props.is_exit || item.props.dont_apply_terrain_scaling) return;
    const pos = this.position;
    item.props.z_index = Math.min(Math.trunc(pos.y), Z_MAX);
    if (this.terrain) {
      this.scale = this.terrain.scaleAt(pos);
      item.props.scale = { type: "Vector2", args: [this.scale, this.scale] };
      item.props.modulate = this.terrain.lightAt(pos); // get_light()
    }
    if (this.sprite) {
      const sc = vec2(this.sprite.props.scale, 1, 1);
      if ((this.mirrored && sc.x > 0) || (!this.mirrored && sc.x < 0)) {
        this.sprite.props.scale = { type: "Vector2", args: [-sc.x, sc.y] };
        const col = item.children.find((c) => c.type === "CollisionShape2D" || c.type === "CollisionPolygon2D");
        if (col) {
          const cs = vec2(col.props.scale, 1, 1);
          col.props.scale = { type: "Vector2", args: [-cs.x, cs.y] };
        }
      }
    }
  }
}
