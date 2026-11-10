// Plays a walkthrough by itself (for testing, and to record a video of it):
//   player/?game=...&auto=../tools/walkthroughs/x.json[&speed=2][&record=name]
//
// The steps click like a player does (the mouse goes there, then press,
// release and click through the player's input path):
//   {"verb": "look", "object": "plant"}                 verb, then the object
//   {"verb": "use", "item": "inv_bullets", "object": "inv_gun"}   verb, item, target
//   {"choose": "As you were."}                          an option of the chooser
//   {"click": "title" | "screen"}                       a click in the middle of the screen
//   {"wait": seconds}  {"waitRoom": "global id"}
// Before each step it waits until the game takes input (no event running, no
// speech, input mode ALL, the player standing). With &record=name the canvas
// is recorded and the video goes to the server (tools/serve.js saves it in
// out/videos, or in $VIDEO_DIR). Progress goes to the console and to the server's log.
import { collect } from "../src/godot/render.js";
import { controlRect } from "../src/godot/controls.js";
import { itemShapes } from "../src/escoria/ui/game_ui.js";
import { apply } from "../src/godot/render.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runAutopilot(p) {
  const { esc, gameUI, canvas, params } = p;
  const speed = +(params.get("speed") || 1);
  const record = params.get("record");
  const log = (msg) => {
    console.log(`[auto] ${msg}`);
    fetch("/__log", { method: "POST", body: msg }).catch(() => {});
  };
  const walkthrough = await fetch(params.get("auto")).then((r) => r.json());
  esc.timeScale = speed;

  // recording the canvas
  let recorder = null, chunks = [];
  if (record && canvas.captureStream && typeof MediaRecorder !== "undefined") {
    const stream = canvas.captureStream(30);
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6e6 });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(1000);
    log(`grabando (${type})`);
  }
  const finish = async (ok) => {
    log(ok ? "walkthrough finished" : "walkthrough stopped");
    if (!recorder) return;
    await new Promise((r) => {
      recorder.onstop = r;
      recorder.stop();
    });
    const blob = new Blob(chunks, { type: "video/webm" });
    await fetch(`/__video?name=${encodeURIComponent(record)}`, { method: "POST", body: blob });
    log(`video uploaded (${Math.round(blob.size / 1024)} KB)`);
  };

  // ---- waiting
  const idle = () =>
    !esc.events.runningEvent() && !gameUI.speech && !gameUI.chooser && esc.inputMode === "ALL" && esc.state === "DEFAULT" &&
    !(esc.player && esc.player.movable && esc.player.movable.walking) && !(esc.menus && esc.menus.open) && !esc.previousView;
  const watch = (params.get("watch") || "").split(",").filter(Boolean); // globals for the reports
  const state = () => {
    const ev = esc.events.runningEvent();
    return `room ${esc.roomObject?.globalId} · event ${ev ? ev.name + (ev.objectGlobalId ? " of " + ev.objectGlobalId : "") : "-"} · input ${esc.inputMode} · state ${esc.state} · speech ${gameUI.speech ? "yes" : "no"} · chooser ${gameUI.chooser ? "yes" : "no"} · timers ${esc.timers.length} · menu ${esc.menus?.open ? "open" : "no"} · player ${esc.player ? (esc.player.active ? "active" : "inactive") : "-"}${watch.map((g) => ` · ${g}=${JSON.stringify(esc.globals.get(g))}`).join("")}`;
  };
  // cond has to hold for `steady` checks in a row (100 ms each): between a
  // room's :setup and :ready the game looks free for a moment
  const waitFor = async (cond, what, seconds = 180, steady = 3) => {
    const t0 = performance.now();
    let quiet = 0, lastReport = t0;
    while (quiet < steady) {
      if (performance.now() - lastReport > 10000) {
        lastReport = performance.now();
        log(`  waiting for ${what}: ${state()}`);
      }
      if (performance.now() - t0 > seconds * 1000) throw new Error(`didn't happen: ${what} (${state()})`);
      await sleep(100);
      quiet = cond() ? quiet + 1 : 0;
    }
  };

  // ---- clicking like a player
  const roomToScreen = (q) => ({ x: q.x - p.cam().x, y: q.y - p.cam().y });
  const clickAt = async (s, button = 0) => {
    p.hover(s);
    await sleep(120); // a couple of frames: the hovered button is known when it is drawn
    p.click(s, button);
    await sleep(150);
  };
  const objectPoint = (id) => {
    const o = esc.getObject(id);
    if (!o) throw new Error(`no object ${id}`);
    const shapes = itemShapes(o.node);
    if (!shapes.length) return roomToScreen(o.position);
    // the middle of the biggest shape
    const pts = shapes.map((s) => s.pts.map((q) => apply(s.xf, q))).sort((a, b) => b.length - a.length)[0];
    const c = pts.reduce((a, q) => ({ x: a.x + q.x / pts.length, y: a.y + q.y / pts.length }), { x: 0, y: 0 });
    return roomToScreen(c);
  };
  const inventoryPoint = (id) => {
    gameUI.syncInventory();
    const i = gameUI.invOrder.indexOf(id);
    if (i < 0) throw new Error(`${id} is not in the inventory`);
    const box = gameUI.rect(gameUI.invScroll), c = gameUI.gridCell(i);
    return { x: box.x + c.x + c.w / 2, y: box.y + c.y - gameUI.scrollY + c.h / 2 };
  };
  const verbPoint = (v) => {
    const b = gameUI.verbs().find((n) => n.name === v);
    if (!b) return null; // "walk": no button, it is the default
    const r = gameUI.rect(b);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  const pointOf = (id) => (esc.inventory.has(id) ? inventoryPoint(id) : objectPoint(id));

  const run = async (step, n) => {
    const what = JSON.stringify(step);
    if (step.wait) return sleep((step.wait * 1000) / speed);
    if (step.waitRoom) return waitFor(() => esc.roomObject && esc.roomObject.globalId === step.waitRoom && !esc.previousView, `room ${step.waitRoom}`);
    if (step.choose) {
      await waitFor(() => gameUI.chooser, "the chooser");
      const btns = collect(esc.screenRoot, undefined, { allControls: true }).filter((it) => it.node.type === "Button" && it.node.props.visible !== false);
      const b = btns.find((it) => it.node.props.text === step.choose);
      if (b) {
        const r = controlRect(b.node);
        return clickAt({ x: b.xf[4] + Math.min(r.w / 2, 40), y: b.xf[5] + r.h / 2 });
      }
      // the engine's own chooser
      const nb = gameUI.chooserButtons().find((x) => x.text === step.choose || x.option?.text === step.choose);
      if (!nb) throw new Error(`no option "${step.choose}"`);
      return clickAt({ x: nb.x + 10, y: nb.y + nb.h / 2 });
    }
    if (step.click) {
      if (step.click === "title") await sleep(2500);
      return clickAt({ x: canvas.width / 2, y: canvas.height / 3 });
    }
    await waitFor(idle, `being able to play (step ${n})`, 180, 15);
    const vp = verbPoint(step.verb);
    if (vp) await clickAt(vp);
    log(`  verb ${step.verb}: button ${vp ? JSON.stringify(vp) : "-"} -> chosen action "${gameUI.selectedAction}" / "${esc.actions.currentAction}"`);
    if (step.item) await clickAt(pointOf(step.item));
    const op = pointOf(step.object);
    const under = !esc.inventory.has(step.object) ? gameUI.itemAt({ x: op.x + p.cam().x, y: op.y + p.cam().y }) : null;
    await clickAt(op);
    log(`  object ${step.object} at ${JSON.stringify({ x: Math.round(op.x), y: Math.round(op.y) })}: under the point ${under ? under.globalId : "(inventory or nothing)"} · action ${esc.actions.currentAction} · action state ${esc.actions.state} · walking ${!!esc.player?.movable?.walking}`);
    // the action starts (the player walks, an event runs)
    await sleep(400);
  };

  try {
    for (let i = 0; i < walkthrough.steps.length; i++) {
      const step = walkthrough.steps[i];
      log(`step ${i + 1}/${walkthrough.steps.length}: ${JSON.stringify(step)} [${state()}]`);
      // the game takes input, and the step's objects are there (the intro goes through other rooms first)
      const ids = [step.object, step.item].filter(Boolean);
      if (!step.choose && !step.click && !step.wait && !step.waitRoom) await waitFor(() => idle() && ids.every((id) => esc.getObject(id)), `being able to play step ${i + 1}`, 300, 15);
      await run(step, i + 1);
    }
    await waitFor(() => p.ended(), "the end of the game", 60).catch(() => {});
    await sleep(1500);
    await finish(true);
  } catch (e) {
    log(`ERROR: ${e.message}`);
    await sleep(2000);
    await finish(false);
  }
  window.__autopilotDone = true;
}
