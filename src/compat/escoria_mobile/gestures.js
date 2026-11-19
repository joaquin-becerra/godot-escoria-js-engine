// Touch gestures of the Escoria Mobile addon (addons/escoria-mobile,
// mobile_input.gd), for GEJE: the same gestures become the same clicks.
//
//   tap on a button / GUI       -> left click right away
//   1st tap on an item          -> hover only (its name / default verb show)
//   2nd tap on the same item    -> left click (action)
//   tap on the floor            -> left click (walk)
//   double tap on the floor     -> double click (run)
//   long press                  -> right click
//   drag                        -> the cursor follows the finger; released on
//                                  a button, it clicks it
//
// The browser's own handling of touches (mouse emulation, scrolling, zoom,
// the context menu of a long press) is turned off on the canvas: only the
// first finger counts.

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {object} o.settings  the addon's settings (see index.js)
 * @param {object} o.pointer   the player's input: toGame(clientX, clientY),
 *   hover(s), click(s, button, double), isGui(s), item() (the hovered item),
 *   armed(item, s) (optional: a 1st tap showed that item)
 * @param {(msg: string) => void} o.log
 */
export function installGestures({ canvas, settings, pointer, log, state = { active: settings.enabled === 1 } }) {
  canvas.style.touchAction = "none"; // no scroll / zoom gestures from the browser
  canvas.style.webkitUserSelect = canvas.style.userSelect = "none";
  canvas.style.webkitTouchCallout = "none";

  let finger = null; // identifier of the touch we follow
  let down = null; // {s, client, t}
  let moved = false, longFired = false, longTimer = 0;
  let armed = null; // item hovered by a 1st tap
  let lastFloor = { t: -1e9, client: null };
  // state.active: on with the first touch (Auto), shared with the layout

  // millimeters to CSS pixels (CSS: 96 px per inch)
  const mm = (v) => (v * 96) / 25.4;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const onStart = (e) => {
    e.preventDefault(); // no emulated mouse events, no long-press menu
    if (finger !== null) return;
    const t = e.changedTouches[0];
    if (!state.active) {
      state.active = true;
      log(`active, ${window.devicePixelRatio || 1}x pixels`);
    }
    finger = t.identifier;
    const client = { x: t.clientX, y: t.clientY };
    down = { s: pointer.toGame(client.x, client.y), client, t: performance.now() };
    moved = false;
    longFired = false;
    clearTimeout(longTimer);
    longTimer = setTimeout(() => {
      if (!down || moved) return;
      longFired = true;
      armed = null;
      pointer.hover(down.s);
      pointer.click(down.s, 2);
      log("long press -> right click");
    }, settings.longPressMs);
  };

  const ours = (e) => [...e.changedTouches].find((t) => t.identifier === finger);

  const onMove = (e) => {
    e.preventDefault();
    const t = ours(e);
    if (!t || !down) return;
    const client = { x: t.clientX, y: t.clientY };
    if (!moved && dist(client, down.client) > mm(settings.tapSlopMm)) {
      moved = true;
      clearTimeout(longTimer);
      armed = null;
    }
    if (moved) pointer.hover(pointer.toGame(client.x, client.y)); // drag: the cursor follows
  };

  const onEnd = (e) => {
    e.preventDefault();
    const t = ours(e);
    if (!t) return;
    finger = null;
    clearTimeout(longTimer);
    const client = { x: t.clientX, y: t.clientY };
    const s = pointer.toGame(client.x, client.y);
    const was = down;
    down = null;
    if (e.type === "touchcancel" || longFired || !was) return;
    if (moved) {
      // a drag that ends on a button clicks it (a slightly shaky tap)
      if (pointer.isGui(s)) {
        pointer.hover(s);
        pointer.click(s, 0);
        log("drag released on GUI -> click");
      }
      return;
    }
    tap(s, client);
  };

  function tap(s, client) {
    const now = performance.now();
    if (pointer.isGui(s)) {
      armed = null;
      pointer.hover(s);
      pointer.click(s, 0);
      log("tap -> click (GUI / not room input)");
      return;
    }
    pointer.hover(s);
    const item = pointer.item();
    if (item) {
      const name = item.node && item.node.props ? item.node.props.tooltip_name || "" : "";
      if (!settings.twoTapAction || !name || armed === item) {
        armed = null;
        pointer.click(s, 0);
        log(`tap on ${name || "item"} -> click`);
      } else {
        armed = item;
        pointer.armed?.(item, s); // the layout opens the verb drawer
        log(`1st tap on ${name} -> hover`);
      }
      return;
    }
    armed = null;
    const double = now - lastFloor.t < settings.doubleTapMs && lastFloor.client
      && dist(client, lastFloor.client) < mm(settings.tapSlopMm) * 3;
    pointer.click(s, 0, double);
    lastFloor = double ? { t: -1e9, client: null } : { t: now, client };
    log(double ? "double tap -> run" : "floor tap -> walk");
  }

  canvas.addEventListener("touchstart", onStart, { passive: false });
  canvas.addEventListener("touchmove", onMove, { passive: false });
  canvas.addEventListener("touchend", onEnd, { passive: false });
  canvas.addEventListener("touchcancel", onEnd, { passive: false });
  return { state };
}
