// ESCAnimationPlayer (esc_animation_player.gd): one interface over an
// AnimationPlayer or an AnimatedSprite2D, as Escoria uses it for items.
import { animations, tracks, applyAnimation, spriteAnimation } from "./animation.js";
import { list } from "./values.js";

export class AnimPlayer {
  static stopPauses = false;

  constructor(node) {
    this.node = node;
    this.isSprite = node.type === "AnimatedSprite2D";
  }

  names() {
    if (this.isSprite) return ((this.node.props.sprite_frames?.props?.animations) || []).map((a) => a.name);
    return Object.keys(animations(this.node));
  }

  has(name) {
    return this.names().includes(name);
  }

  /** Current animation name ("" if none). */
  current() {
    const st = this.node.state;
    if (this.isSprite) return st.animation ?? this.node.props.animation ?? "";
    return st.current ?? (this.node.props.autoplay || "");
  }

  isPlaying() {
    return !!this.node.state.playing;
  }

  play(name, backwards = false) {
    const st = this.node.state;
    if (this.isSprite) {
      st.animation = name;
      const anim = spriteAnimation(this.node);
      st.frame = backwards && anim ? anim.frames.length - 1 : 0;
      st.elapsed = 0;
      st.playing = true;
      st.backwards = backwards;
      return;
    }
    const anim = animations(this.node)[name];
    if (!anim) return;
    st.current = name;
    st.length = anim.props.length ?? 1;
    st.time = backwards ? st.length : 0;
    st.backwards = backwards;
    st.playing = true;
    applyAnimation(this.node, anim, st.time);
  }

  /**
   * stop(): an AnimatedSprite2D goes back to its first frame, as Godot 4 does;
   * a game can make it pause on its frame instead (AnimPlayer.stopPauses).
   */
  stop() {
    this.node.state.playing = false;
    if (this.isSprite && !AnimPlayer.stopPauses) this.node.state.frame = 0;
  }

  /** seek_end(): jump to the end of an animation. */
  seekEnd(name) {
    if (this.isSprite) {
      this.play(name);
      const anim = spriteAnimation(this.node);
      if (anim) this.node.state.frame = anim.frames.length - 1;
      this.node.state.playing = false;
      return;
    }
    const anim = animations(this.node)[name];
    if (!anim) return;
    const st = this.node.state;
    st.current = name;
    st.time = anim.props.length ?? 0;
    st.playing = false;
    applyAnimation(this.node, anim, st.time);
  }

  /** Resolves when the current animation ends (at once if it loops or isn't playing). */
  finished() {
    return new Promise((ok) => {
      const st = this.node.state;
      if (!st.playing) return ok();
      (st.onFinished ||= []).push(ok);
    });
  }
}

/** Advances an AnimationPlayer that is playing (value tracks only). */
export function advancePlayer(node, dt) {
  const st = node.state;
  if (st.playing === undefined && node.props.autoplay) new AnimPlayer(node).play(node.props.autoplay);
  if (!st.playing) return;
  const anim = animations(node)[st.current];
  if (!anim) return (st.playing = false);
  const loop = (anim.props.loop_mode ?? 0) !== 0;
  st.time += st.backwards ? -dt : dt;
  let done = false;
  if (st.time > st.length || st.time < 0) {
    if (loop) st.time = ((st.time % st.length) + st.length) % st.length;
    else {
      st.time = Math.max(0, Math.min(st.time, st.length));
      done = true;
    }
  }
  applyAnimation(node, anim, st.time);
  if (done) {
    st.playing = false;
    const cbs = st.onFinished || [];
    st.onFinished = [];
    cbs.forEach((f) => f());
  }
}

export { tracks, list };
