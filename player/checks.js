// Checks of what a player would see, frame by frame, while a walkthrough is
// played (the fast test in Node, tools/geje-test/play.js, and the test in the
// browser, player/geje_test.js):
//   1. a character left with its talking animation while someone else's line
//      is on screen (0.5 s), or with no line at all (5 s)
//   2. a visible gap: an object stops being drawn and what replaces it near
//      there appears more than a frame later (an animation that hides its
//      sprite at its end before the script shows what comes next)
//   3. turn_to that leaves the character facing away from its target
//
// installChecks({esc, gameUI, Movable, drawn, now, issue}) -> tick(): call it
// once a frame, after the frame is drawn. drawn(): render.js collect() items
// of the frame; now(): game seconds; issue(level, msg).

const TALK_LIMIT = 5; // some games keep the lips moving a while after a skipped line (Sosage: 0.05 s per character, up to ~4 s)
const GAP_WINDOW = 0.5, GAP_NEAR = 300;

/** The global id of the Escoria object a node belongs to (else its name). */
export const ownerOf = (n) => {
  for (let x = n; x; x = x.parent) if (x.props && x.props.global_id) return x.props.global_id;
  return n.name;
};

export function installChecks({ esc, gameUI, Movable, drawn, now, issue }) {
  // 1.
  const talking = new Map(); // global id -> {t, speaker} | "reported"
  const speakOnly = (m) => {
    const a = m.anims;
    if (!a) return new Set();
    const names = (k) => (a[k] || []).map((d) => d && d.props && d.props.animation).filter(Boolean);
    const other = new Set([...names("idles"), ...names("directions")]);
    return new Set(names("speaks").filter((n) => !other.has(n)));
  };
  // 2.
  let shownBefore = new Map(); // global id -> {x, y}
  let hidden = []; // [{id, t, x, y}] of the last half second
  let lastRoom = null;
  let frame = 0; // a gap is counted in frames (at 4x a frame is more game time)

  // 3. (the direction's idle animation says left / right: the name is the
  // facing it ends with, mirrored or not, e.g. scumm2escoria's idle_left is
  // right-facing frames mirrored)
  if (!Movable.prototype.__checked) {
    const origTurn = Movable.prototype.turnTo;
    Movable.prototype.turnTo = function (node, ...rest) {
      const p0 = this.position, q = node.props && node.props.position;
      const r = origTurn.call(this, node, ...rest);
      if (q && q.args && this.anims && this.anims.idles) {
        const dx = q.args[0] - p0.x;
        const deg = ((Math.trunc((Math.atan2(q.args[1] - p0.y, dx) * 180) / Math.PI) % 360) + 360) % 360;
        const idle = this.anims.idles[this.dirForDegrees(deg)];
        const name = (idle && idle.props && idle.props.animation) || "";
        const side = /left/i.test(name) ? -1 : /right/i.test(name) ? 1 : 0;
        if (side && Math.abs(dx) > 40 && Math.sign(dx) !== side)
          Movable.prototype.__checked.issue("warn", `${ownerOf(this.item)}: turn_to ${node.props.global_id || node.name} leaves it facing ${side < 0 ? "left" : "right"} ("${name}"), the target is to its ${dx < 0 ? "left" : "right"}`);
      }
      return r;
    };
  }
  Movable.prototype.__checked = { issue };

  return function tick() {
    if (!esc.view) return;
    const t = now();
    frame++;
    // 1.
    const speaker = gameUI.speech && gameUI.speech.obj ? gameUI.speech.obj.globalId : null;
    for (const o of esc.objects.values()) {
      const m = o.movable;
      if (!m || !o.active) continue;
      const cur = m.animator ? m.animator.current() : m.sprite && m.sprite.state.animation;
      const playing = m.animator ? m.animator.isPlaying() : m.sprite && m.sprite.state.playing;
      // its own line on screen: fine
      if (!cur || !playing || speaker === o.globalId || !speakOnly(m).has(cur)) {
        talking.delete(o.globalId);
        continue;
      }
      const limit = speaker ? 0.5 : TALK_LIMIT;
      let since = talking.get(o.globalId);
      if (since === "reported") continue;
      if (since === undefined || since.speaker !== speaker) talking.set(o.globalId, (since = { t, speaker }));
      else if (t - since.t > limit) {
        issue("warn", speaker
          ? `${o.globalId}: keeps its talking animation "${cur}" while ${speaker} speaks (since ${since.t.toFixed(2)} s)`
          : `${o.globalId}: keeps its talking animation "${cur}" with no line on screen (since ${since.t.toFixed(2)} s)`);
        talking.set(o.globalId, "reported");
      }
    }
    // 2.
    // the room drawn (the previous one until the new one's :setup ends), and
    // not while a transition covers the screen: a room change isn't a gap
    const room = esc.transitions && esc.transitions.covering ? null : esc.shownView ? esc.shownView.room : null;
    const seen = new Map();
    for (const it of drawn()) {
      const id = ownerOf(it.node);
      if (!esc.objects.has(id) || seen.has(id)) continue;
      seen.set(id, { x: it.xf[4], y: it.xf[5] });
    }
    if (room && room === lastRoom && seen.size) {
      const gone = [...shownBefore].filter(([id]) => !seen.has(id));
      const came = [...seen].filter(([id]) => !shownBefore.has(id));
      // many at once: a room, a menu or the inventory, not an animation
      if (gone.length + came.length <= 6) {
        for (const [id, q] of gone) hidden.push({ id, t, frame, ...q });
        for (const [id, q] of came) {
          // the first one that appears near is what replaced it (taken off the list)
          const h = hidden.find((h) => h.id !== id && Math.hypot(h.x - q.x, h.y - q.y) < GAP_NEAR);
          if (!h) continue;
          hidden.splice(hidden.indexOf(h), 1);
          if (frame - h.frame > 1) issue("warn", `visible gap of ${frame - h.frame - 1} frames (${(t - h.t).toFixed(2)} s): ${h.id} stopped being drawn and ${id} appeared after it`);
        }
      }
    } else hidden = [];
    hidden = hidden.filter((h) => t - h.t <= GAP_WINDOW);
    shownBefore = seen;
    lastRoom = room;
  };
}
