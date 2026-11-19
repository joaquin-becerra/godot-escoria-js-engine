// Escoria's reserved sound objects (_music, _sound, _speech, _ambient):
// esc_music_player.gd / esc_sound_player.gd. Each has a state: the path of
// what plays, or "off" / "default". Music loops; the others play once.
//
// Browsers don't play audio before the first click on the page: what is asked
// before that starts with the first click.

const CHANNELS = {
  _music: { loop: true, volume: "music" },
  _sound: { loop: false, volume: "sfx" },
  _speech: { loop: false, volume: "speech" },
  _ambient: { loop: true, volume: "ambient" },
};

let unlocked = false;
const waiting = new Set();
if (typeof window !== "undefined") {
  const unlock = () => {
    unlocked = true;
    for (const a of waiting) a.play().catch(() => {});
    waiting.clear();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/** Plays an <audio>, now or after the first click. */
export function playAudio(audio) {
  audio.play().catch(() => {
    if (!unlocked) waiting.add(audio);
  });
}

export class SoundPlayer {
  constructor(esc, id) {
    this.esc = esc;
    this.id = id;
    this.conf = CHANNELS[id];
    this.state = "default";
    this.audio = null;
    this.onFinished = [];
  }

  volume() {
    if (this.esc.muted) return 0;
    const s = this.esc.settings || {};
    return Math.min(1, (s.master ?? 1) * (s[this.conf.volume] ?? 1));
  }

  applyVolume() {
    if (this.audio) this.audio.volume = this.volume();
  }

  playing() {
    return !!this.audio && !this.audio.paused && !this.audio.ended;
  }

  /** set_state(): a res:// path to play, or "off" / "default" to stop. */
  setState(state, fromSeconds = 0, force = false) {
    if (state === this.state && !force && this.playing()) return;
    this.state = state;
    if (this.audio) {
      this.audio.pause();
      waiting.delete(this.audio);
      this.audio = null;
    }
    if (state === "off" || state === "default" || !state) return;
    const a = new Audio(this.esc.game.url(state));
    a.loop = this.conf.loop;
    a.volume = this.volume();
    if (fromSeconds) a.currentTime = fromSeconds;
    a.addEventListener("ended", () => {
      if (this.audio !== a) return;
      if (!this.conf.loop) this.state = "default"; // _on_sound_finished()
      const cbs = this.onFinished;
      this.onFinished = [];
      cbs.forEach((f) => f());
    });
    this.audio = a;
    playAudio(a);
  }

  pause() {
    if (this.audio) this.audio.pause();
  }

  resume() {
    if (this.audio && this.state !== "off" && this.state !== "default") playAudio(this.audio);
  }

  position() {
    return this.audio ? this.audio.currentTime : 0;
  }
}

export const SOUND_CHANNELS = Object.keys(CHANNELS);
