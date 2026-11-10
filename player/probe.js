// window.__probe: what an outside driver (tools/compare/run.js) needs to play
// the game with the real mouse and to compare it with Godot's web build
// (the same API is given there by the probe.gd autoload):
//   state()       -> {room, idle, chooser, options, speech, inventory, globals, ended}
//   where(target) -> {x, y} in canvas pixels, or null
//                    target: {verb} | {object} (room object or inventory item) | {option: text}
//   setSpeed(x)   -> the game's time scale
import { collect } from "../src/godot/render.js";
import { controlRect } from "../src/godot/controls.js";
import { itemShapes } from "../src/escoria/ui/game_ui.js";
import { apply } from "../src/godot/render.js";

export function installProbe(p) {
  const { esc, gameUI, canvas } = p;
  const roomToScreen = (q) => ({ x: q.x - p.cam().x, y: q.y - p.cam().y });

  const idle = () =>
    !esc.events.runningEvent() && !gameUI.speech && !gameUI.chooser && esc.inputMode === "ALL" && esc.state === "DEFAULT" &&
    !(esc.player && esc.player.movable && esc.player.movable.walking) && !(esc.menus && esc.menus.open) && !esc.previousView;

  // the chooser's options: the game's own chooser scene, else the engine's
  const options = () => {
    if (!gameUI.chooser) return [];
    // (not the one-character scroll arrows; same in probe.gd)
    const btns = collect(esc.screenRoot, undefined, { allControls: true }).filter((it) => it.node.type === "Button" && it.node.props.visible !== false && (it.node.props.text || "").trim().length > 1);
    if (btns.length)
      return btns.map((b) => {
        const r = controlRect(b.node);
        return { text: b.node.props.text, x: b.xf[4] + Math.min(r.w / 2, 40), y: b.xf[5] + r.h / 2 };
      });
    return gameUI.chooserButtons().map((b) => ({ text: b.option?.text ?? b.text, x: b.x + 10, y: b.y + b.h / 2 }));
  };

  const polys = (o) => itemShapes(o.node).map((s) => s.pts.map((q) => apply(s.xf, q)));
  // the point of the object's shapes nearest to their middle that no
  // character covers (the player may stand in front of it); same in probe.gd
  const objectPoint = (id) => {
    const o = esc.objects.get(id);
    if (!o || !o.active) return null;
    const mine = polys(o);
    if (!mine.length) return roomToScreen(o.position);
    const others = [...esc.objects.values()].filter((x) => x !== o && x.active && x.movable).flatMap(polys);
    return roomToScreen(freePoint(mine, others));
  };
  const inventoryPoint = (id) => {
    gameUI.syncInventory();
    const i = gameUI.invOrder.indexOf(id);
    if (i < 0) return null;
    const box = gameUI.rect(gameUI.invScroll), c = gameUI.gridCell(i);
    return { x: box.x + c.x + c.w / 2, y: box.y + c.y - gameUI.scrollY + c.h / 2 };
  };
  const verbPoint = (v) => {
    const b = gameUI.verbs().find((n) => n.name === v);
    if (!b) return null;
    const r = gameUI.rect(b);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };

  const plain = (v) => (v === undefined || typeof v === "function" ? null : JSON.parse(JSON.stringify(v ?? null)));
  window.__probe = {
    engine: "js",
    size: () => ({ w: canvas.width, h: canvas.height }),
    state() {
      const globals = {};
      for (const [k, v] of esc.globals.values) if (!esc.globals.reserved.has(k)) globals[k] = plain(v);
      return {
        room: esc.roomObject?.globalId ?? null,
        idle: idle(),
        input: esc.inputMode === "ALL",
        chooser: !!gameUI.chooser,
        options: options().map((o) => o.text),
        speech: gameUI.speech ? gameUI.speech.text : null,
        hover: gameUI.hover ? gameUI.hover.globalId : null,
        action: gameUI.selectedAction || esc.actions.currentAction || null,
        inventory: esc.inventory.items().sort(),
        globals,
        ended: p.ended(),
      };
    },
    where(t) {
      if (t.verb) return verbPoint(t.verb);
      if (t.option) return options().find((o) => o.text === t.option) || null;
      if (t.object) return esc.inventory.has(t.object) ? inventoryPoint(t.object) : objectPoint(t.object);
      return null;
    },
    setSpeed(x) {
      esc.timeScale = x;
    },
  };
}

const inside = (poly, q) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
// polygons -> the point (an 8 px grid) inside them and outside `others`
// nearest to the middle of the biggest one
export function freePoint(mine, others, step = 8) {
  const big = [...mine].sort((a, b) => b.length - a.length)[0];
  const mid = big.reduce((a, q) => ({ x: a.x + q.x / big.length, y: a.y + q.y / big.length }), { x: 0, y: 0 });
  let best = null, bd = Infinity;
  for (const poly of mine) {
    const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y);
    for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x += step)
      for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y += step) {
        const q = { x, y };
        if (!inside(poly, q) || others.some((p) => inside(p, q))) continue;
        const d = (x - mid.x) ** 2 + (y - mid.y) ** 2;
        if (d < bd) (bd = d), (best = q);
      }
  }
  return best || mid;
}
