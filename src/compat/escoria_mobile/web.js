// Web extras of the Escoria Mobile addon (mobile_input.gd, rotate_hint.gd),
// for GEJE:
//
//   escoria/mobile/web/fullscreen_on_first_touch
//       the first touch puts the page in fullscreen (browsers only allow it
//       from a user gesture: it's asked when that touch ends).
//   escoria/mobile/web/landscape
//       in fullscreen, the orientation is locked to landscape where the
//       browser allows it (Android); while the screen is in portrait, a
//       "turn your phone" hint covers the game (iPhone can't lock it). It's
//       drawn, not written, so it works in any language.

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {object} o.host      the player's side (player.js mobileHost)
 * @param {object} o.settings  index.js mobileSettings()
 * @param {(msg: string) => void} o.log
 */
export function installWeb({ canvas, host, settings, log }) {
  const web = settings.web;
  let asked = false;

  const lockLandscape = () => {
    if (!web.landscape || !screen.orientation || !screen.orientation.lock) return;
    screen.orientation.lock("landscape").then(
      () => log("orientation locked to landscape"),
      (e) => log(`can't lock the orientation: ${e.message}`),
    );
  };
  if (web.landscape) document.addEventListener("fullscreenchange", () => document.fullscreenElement && lockLandscape());

  // the first touch: fullscreen (and with it, the landscape lock)
  canvas.addEventListener("touchend", () => {
    if (asked) return;
    asked = true;
    if (!web.fullscreen || document.fullscreenElement) return lockLandscape();
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return lockLandscape();
    Promise.resolve(req.call(el, { navigationUI: "hide" })).then(
      () => log("fullscreen"),
      (e) => log(`can't go fullscreen: ${e && e.message}`),
    );
  }, { passive: true });

  const portrait = () => web.landscape && window.innerHeight > window.innerWidth;

  // the hint: a dark layer, a dim portrait phone, an arrow, a bright landscape phone
  host.onDraw((ctx) => {
    if (!portrait()) return;
    const v = host.view, fg = settings.style.foreground;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.92)";
    ctx.fillRect(0, 0, v.w, v.h);
    const cx = v.w / 2, cy = v.h / 2, u = Math.min(v.w, v.h) / 10;
    const phone = (x, y, w, h, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ctx.fillStyle = fg;
      ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.06);
      ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      const dot = h > w ? { x, y: y + h * 0.38 } : { x: x + w * 0.38, y };
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, Math.min(w, h) * 0.06, 0, Math.PI * 2);
      ctx.fill();
    };
    phone(cx - u * 2.2, cy, u * 1.6, u * 2.8, 0.45);
    phone(cx + u * 2.2, cy, u * 2.8, u * 1.6, 1);
    ctx.globalAlpha = 1;
    ctx.lineWidth = u * 0.18;
    ctx.beginPath();
    ctx.moveTo(cx - u * 0.6, cy);
    ctx.lineTo(cx + u * 0.5, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + u * 0.95, cy);
    ctx.lineTo(cx + u * 0.4, cy - u * 0.4);
    ctx.lineTo(cx + u * 0.4, cy + u * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

  return {
    /** While the hint shows, the game below can't be played. */
    blocking: portrait,
  };
}
