// Plays the steps of a walkthrough (geje-test/*.json) like a player does: the
// mouse goes to the target, it has to be under the mouse, then the click; a
// verb step that changes nothing is played again (up to 5 times); lines of
// speech are skipped after 0.8 s. The same rules as tools/compare/run.js.
//
// No DOM, no clock of its own: `api` gives them. Used by the fast test in Node
// (tools/geje-test/play.js, on the headless player) and by the test in the
// browser (player/geje_test.js, on the real player).
//
// api: {
//   state(), where(target)        the probe (player/probe.js)
//   hover(p), click(p), wheel(dy), key(k)   input, in canvas pixels
//   wait(seconds), now()          game time
//   size: {w, h}
//   inInventory(id), describe(id) (an object, for error messages)
// }
//
// Steps:
//   {verb, object[, item]}  {go: id}  {choose: text}  {text: label[, before]}
//   {pick: label, object[, item]} (a scripted UI's selector)  {world: [x, y][, before]}
//   {click: "title"|"screen"}  {wait: s}  {waitInput}  {waitRoom: id}  {waitGlobal: {k: v}}
//   {waitText: "Well done"} (a visible text that starts so)  {waitClick} (the game waits for a click)
//   until: "chooser" | {inventory: id} | {lost: id} | {room: id} | false;  busy: the step ends busy
// walk: {steps, ui: "simplemouse"?, locale: "en"? (set before step 1), skipKey?, world: [w, h]?, floorY?}

const SKIP_AFTER = 0.8;
// globals that change on any click or by themselves (scumm2escoria's action
// bookkeeping, roaming): they don't count as the step doing something
export const NOISE = /^scumm_(a_|object_|roam_)/;

export function createDriver(walk, api) {
  const { size } = api;
  const stats = { skipped: 0, retries: 0 };
  const state = () => api.state();

  // a line of speech shown for a while: a click (or walk.skipKey) skips it
  let speech = null, speechSince = 0;
  const skipSpeech = async (s) => {
    if (s.speech !== speech) (speech = s.speech), (speechSince = api.now());
    if (!speech || api.now() - speechSince < SKIP_AFTER) return;
    if (walk.skipKey) api.key(walk.skipKey === "Space" ? " " : walk.skipKey);
    else api.click({ x: size.w / 2, y: size.h * 0.76 });
    stats.skipped++;
    speechSince = api.now();
  };

  // cond(state) has to hold `steady` checks in a row (0.1 s of game time each)
  const waitFor = async (cond, what, seconds = 180, steady = 3) => {
    const start = api.now();
    let quiet = 0, last = null;
    while (quiet < steady) {
      if (api.now() - start > seconds) throw new Error(`didn't happen: ${what} (state: ${JSON.stringify(last && { ...last, globals: undefined })})`);
      await api.wait(0.1);
      last = state();
      quiet = last && cond(last) ? quiet + 1 : 0;
      if (last) await skipSpeech(last);
    }
    return last;
  };

  const where = (target, what) => {
    const q = api.where(target);
    if (!q) throw new Error(`can't find ${what}`);
    return q;
  };

  const click = async (q, id) => {
    api.hover(q);
    await api.wait(0.15);
    // someone walking (OQ's roaming Zif) may stand in front of it for a while:
    // as a player, wait for it to be clear (up to 60 s of game time)
    for (let i = 0; id && i < 300; i++) {
      await api.wait(0.2);
      if (state().hover === id) break;
      if (i === 299) throw new Error(`${id} doesn't stay under the mouse (at ${Math.round(q.x)},${Math.round(q.y)} there is ${state().hover}; ${api.describe(id)})`);
      const q2 = api.where({ object: id });
      if (q2) q = q2;
      api.hover({ x: q.x + (i % 2), y: q.y });
    }
    api.click(q);
    await api.wait(0.2);
  };

  // simplemouse: the inventory panel slides up when the mouse reaches its title
  const openInventory = async () => {
    if (walk.ui !== "simplemouse") return;
    api.hover({ x: size.w / 2, y: size.h - 8 });
    await api.wait(0.6);
  };

  const fingerprint = (s) => JSON.stringify([s.room, s.inventory, s.chooser, Object.entries(s.globals || {}).filter(([k]) => !NOISE.test(k))]);
  const happened = (u, s, before) =>
    u === "chooser" ? s.chooser
    : u && u.inventory ? s.inventory.includes(u.inventory)
    : u && u.lost ? !s.inventory.includes(u.lost)
    : u && u.room ? s.room === u.room
    : fingerprint(s) !== before;

  async function run(step) {
    const verbStep = step.verb || step.object || step.pick;
    if (!verbStep || step.until === false) return runOnce(step);
    for (let i = 1; ; i++) {
      const before = fingerprint(state());
      await runOnce(step);
      const s = await waitFor((s) => (step.until && happened(step.until, s, before)) || s.idle || s.chooser || s.ended, "the step to finish", 120, 5);
      if (happened(step.until, s, before)) return;
      if (i === 5) throw new Error(`the step changed nothing in 5 tries${step.until ? " (" + JSON.stringify(step.until) + ")" : ""}`);
      stats.retries++;
    }
  }

  async function runOnce(step) {
    if (step.wait) return api.wait(step.wait);
    if (step.waitInput) return waitFor((s) => s.input && !s.speech && !s.chooser, "the game to take clicks", 300, 10);
    if (step.waitRoom) return waitFor((s) => s.room === step.waitRoom, `room ${step.waitRoom}`, 300);
    if (step.waitClick) return waitFor((s) => s.waitingClick, "the game to wait for a click", 300, 2);
    if (step.waitText) return waitFor(() => api.where({ textStart: step.waitText }), `text "${step.waitText}…"`, 120, 2);
    if (step.waitGlobal) return waitFor((s) => Object.entries(step.waitGlobal).every(([k, v]) => s.globals[k] === v), `global ${JSON.stringify(step.waitGlobal)}`, 300);
    if (step.click) {
      if (step.click === "title") await api.wait(2.5);
      return click({ x: size.w / 2, y: size.h / 3 });
    }
    if (step.world) {
      await waitFor((s) => !s.speech, "no speech", 60, 3);
      await api.wait(step.before ?? 0.6);
      const [ww, wh] = walk.world;
      return click({ x: (step.world[0] / ww) * size.w, y: (step.world[1] / wh) * size.h });
    }
    if (step.text) {
      if (step.before) await api.wait(step.before);
      let q = null;
      await waitFor(() => (q = api.where({ text: step.text })), `text "${step.text}"`, 120);
      return click(q);
    }
    if (step.pick) {
      await waitFor((s) => s.idle && (!step.object || api.where({ object: step.object })), `being able to play with ${step.object}`, 300, 15);
      const inInv = state().inventory.includes(step.object);
      // off screen (a scrolling room): walk to that side first (a click on the floor)
      for (let i = 0; !inInv && i < 4; i++) {
        const q = where({ object: step.object }, step.object);
        if (q.x >= size.w * 0.03 && q.x <= size.w * 0.97) break;
        await click({ x: q.x < 0 ? size.w * 0.08 : size.w * 0.92, y: size.h * (walk.floorY ?? 0.88) });
        await waitFor((s) => s.idle, "walking to the side", 60, 5);
      }
      await click(where({ object: step.object }, step.object), inInv ? null : step.object);
      let q = null;
      await waitFor(() => (q = api.where({ text: step.pick })), `label "${step.pick}"`, 10, 2);
      await api.wait(0.15);
      await click(q);
      if (step.item) {
        await api.wait(0.7); // the inventory slides up
        let qi = null;
        await waitFor(() => (qi = api.where({ object: step.item })), `inventory item ${step.item}`, 10, 3);
        await click(qi);
      }
      return api.wait(0.4);
    }
    if (step.go) {
      await waitFor((s) => s.idle && api.where({ object: step.go }), `being able to go to ${step.go}`, 300, 15);
      await click(where({ object: step.go }, step.go), step.go);
      return api.wait(0.4);
    }
    if (step.choose) {
      await waitFor((s) => s.chooser && s.options.includes(step.choose), `option "${step.choose}"`, 120);
      return click(where({ option: step.choose }, `option "${step.choose}"`));
    }
    // a verb on an object (with an item)
    const ids = [step.item, step.object].filter(Boolean);
    const inv = (id) => api.inInventory(id);
    await waitFor((s) => s.idle && ids.every((id) => inv(id) || api.where({ object: id })), `being able to play with ${ids.join(", ")}`, 300, 15);
    const s0 = state();
    const roomObject = (id) => (s0.inventory.includes(id) ? null : id);
    if (walk.ui === "simplemouse") {
      // the verb is the cursor: on the first target, the wheel until it's the verb
      const first = step.item || step.object;
      if (inv(first)) await openInventory();
      const q = where({ object: first }, first);
      api.hover(q);
      await api.wait(0.15);
      for (let i = 0; step.verb && step.verb !== "walk" && state().action !== step.verb; i++) {
        if (i === 6) throw new Error(`the wheel doesn't get to verb ${step.verb} (action ${state().action})`);
        api.wheel(1);
        await api.wait(0.05);
      }
      await click(q, roomObject(first));
      if (step.item) {
        if (inv(step.object)) await openInventory();
        await click(where({ object: step.object }, step.object), roomObject(step.object));
      }
      return api.wait(0.4);
    }
    const vp = step.verb === "walk" ? null : where({ verb: step.verb }, `verb ${step.verb}`);
    for (let i = 0; vp && i < 5; i++) {
      await click(vp);
      await api.wait(0.25);
      if (state().action === step.verb) break;
      if (i === 4) throw new Error(`verb ${step.verb} doesn't stay chosen (action ${state().action})`);
    }
    if (step.item) await click(where({ object: step.item }, step.item), roomObject(step.item));
    await click(where({ object: step.object }, step.object), roomObject(step.object));
    await api.wait(0.4);
  }

  /** Plays one step; then (unless `busy`) waits for the game to be free again. */
  async function play(step) {
    await run(step);
    // waiting for a click or an end text: the game is busy then by design
    const busy = step.busy || step.waitClick || step.waitText;
    if (!busy) await waitFor((s) => s.idle || s.chooser || s.ended, "the step to finish", 120, 5).catch(() => null);
  }

  return { play, waitFor, stats };
}
