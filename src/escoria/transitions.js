// Escoria's scene transitions (game/scenes/transitions/esc_transition_player.gd):
// a ColorRect over everything (main.tscn layers/curtain, layer 20) with one of
// the materials in escoria/ui/transition_paths, whose `cutoff` goes 0 -> 1
// ("in", the scene shows) or 1 -> 0 ("out", it gets covered).
//
// The materials are binary (.material) and stock Escoria, so their shader and
// values are here:
//   fade_*:   COLOR = vec4(color.rgb, 1.0 - cutoff)
//   masked:   alpha = smoothstep(cutoff, cutoff + smooth_size,
//                                mask.r * (1.0 - smooth_size) + smooth_size)
// Escoria, MIT license, (c) Godot Escoria contributors.

const MASKS = "res://addons/escoria-core/game/scenes/transitions/masks/";
export const INSTANT = "instant";

export const ESCORIA_TRANSITIONS = {
  fade_black: { color: [0, 0, 0] },
  fade_white: { color: [255, 255, 255] },
  curtain: { color: [0, 0, 0], mask: MASKS + "curtain.png", smooth: 0.134 },
  from_center: { color: [0, 0, 0], mask: MASKS + "from_center.png", smooth: 0.134 },
  shards: { color: [0, 0, 0], mask: MASKS + "shards.png", smooth: 0.134 },
};

/** Images the transitions need (the exporter ships them). */
export const TRANSITION_FILES = Object.values(ESCORIA_TRANSITIONS).map((t) => t.mask).filter(Boolean);

const MASK_RES = 256; // the alpha is computed at this size and stretched

export class TransitionPlayer {
  constructor(esc) {
    this.esc = esc;
    this.current = null; // {name, conf}
    this.cutoff = 1; // nothing covers the scene
    this.tween = null; // {from, to, t, duration, done}
    this.masks = new Map(); // res -> Uint8Array of mask.r at MASK_RES
    this.canvas = null;
  }

  has(name) {
    return name === INSTANT || name in ESCORIA_TRANSITIONS;
  }

  /**
   * transition(): starts it and resolves when it ends (or another one cancels
   * it). "" is the default transition; "instant" uncovers the scene at once.
   */
  async transition(name = "", mode = "in", duration = 1.0) {
    if (!name) name = this.esc.game.setting("escoria/ui/default_transition", INSTANT);
    if (!this.has(name)) this.esc.log(`transition: Transition ${name} not found`, "error");
    if (name === INSTANT || !this.has(name)) {
      this.finishTween();
      this.current = null;
      this.cutoff = 1; // reset_shader_cutoff()
      return;
    }
    const conf = ESCORIA_TRANSITIONS[name];
    if (conf.mask) await this.loadMask(conf.mask);
    this.finishTween(); // a running one is canceled: its waiter goes on
    this.current = { name, conf };
    const [from, to] = mode === "out" ? [1, 0] : [0, 1];
    this.cutoff = from;
    return new Promise((done) => {
      this.tween = { from, to, t: 0, duration: Math.max(duration, 0), done };
    });
  }

  finishTween() {
    const tw = this.tween;
    this.tween = null;
    if (tw) tw.done();
  }

  update(dt) {
    const tw = this.tween;
    if (!tw) return;
    tw.t += dt;
    const k = tw.duration > 0 ? Math.min(tw.t / tw.duration, 1) : 1;
    this.cutoff = tw.from + (tw.to - tw.from) * k;
    if (k >= 1) this.finishTween();
  }

  /** Is the scene (partly) covered? */
  get covering() {
    return !!this.current && this.cutoff < 1;
  }

  async loadMask(res) {
    if (this.masks.has(res)) return;
    const game = this.esc.game;
    const img = game.image(res) || (await game.loadImage(res));
    let data = null;
    try {
      const c = document.createElement("canvas");
      c.width = c.height = MASK_RES;
      const cx = c.getContext("2d");
      cx.drawImage(img, 0, 0, MASK_RES, MASK_RES);
      const px = cx.getImageData(0, 0, MASK_RES, MASK_RES).data;
      data = new Uint8Array(MASK_RES * MASK_RES);
      for (let i = 0; i < data.length; i++) data[i] = px[i * 4];
    } catch {
      data = null; // no canvas (Node): the transition is drawn as a fade
    }
    this.masks.set(res, data);
  }

  draw(ctx, w, h) {
    if (!this.covering) return;
    const { conf } = this.current;
    const [r, g, b] = conf.color;
    const mask = conf.mask && this.masks.get(conf.mask);
    if (!mask) {
      ctx.fillStyle = `rgba(${r},${g},${b},${1 - this.cutoff})`;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = this.canvas.height = MASK_RES;
      this.image = this.canvas.getContext("2d").createImageData(MASK_RES, MASK_RES);
    }
    const s = conf.smooth, c = this.cutoff, px = this.image.data;
    for (let i = 0; i < mask.length; i++) {
      const v = (mask[i] / 255) * (1 - s) + s;
      const x = s > 0 ? Math.min(Math.max((v - c) / s, 0), 1) : v >= c ? 1 : 0;
      const j = i * 4;
      px[j] = r;
      px[j + 1] = g;
      px[j + 2] = b;
      px[j + 3] = Math.round(x * x * (3 - 2 * x) * 255);
    }
    this.canvas.getContext("2d").putImageData(this.image, 0, 0);
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, w, h);
    ctx.imageSmoothingEnabled = smooth;
  }
}
