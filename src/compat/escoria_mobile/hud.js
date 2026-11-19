// HUD of the Escoria Mobile addon (hud.gd), for GEJE: two buttons in a corner
// of the room, drawn over the game.
//
//   gear   opens the pause menu: the same as the Esc key (the game's scripts
//          see it first, like ui_cancel in Godot).
//   star   shows every interactive item of the room for a few seconds (a
//          circle and, with escoria/mobile/hud_hint_names, its name); tapping
//          it again hides them.
//
// The buttons only show while the player can act in the room (no menu,
// cutscene, speech or dialog options) and, with the phone layout, while the
// game's panel is on screen. Position, size, colors and icons:
// escoria/mobile/hud_buttons/* and style/* (see index.js).
import { itemShapes } from "../../escoria/ui/game_ui.js";
import { isItem } from "../../escoria/room.js";
import { apply } from "../../godot/render.js";

/**
 * @param {object} o
 * @param {object} o.host      the player's side (player.js mobileHost)
 * @param {object} o.game
 * @param {object} o.settings  index.js mobileSettings()
 * @param {object|null} o.layout  layout.js API (bottom corners stay above its panel)
 * @param {{active: boolean}} o.touch  shown once touch is used
 */
export function installHud({ host, game, settings, layout, touch }) {
  const hs = settings.hud, st = settings.style;
  let highlightLeft = 0;
  const icons = { gear: null, star: null };
  for (const [k, path] of [["gear", hs.settingsIcon], ["star", hs.highlightIcon]]) {
    if (!path) continue;
    Promise.resolve(game.loadImagesIn({ icon: { $res: path } }))
      .then(() => { icons[k] = game.texture(path) || null; })
      .catch(() => console.warn(`EscoriaMobile: can't load the icon ${path}`));
  }

  // can the player act in the room right now?
  function roomInput() {
    const esc = host.esc, ui = host.gameUI;
    if (!touch.active || !esc || !esc.view || !ui || (host.menus && host.menus.open)) return false;
    if (esc.state !== "DEFAULT" || esc.inputMode !== "ALL" || !ui.visible || ui.chooser || ui.speech) return false;
    return layout ? layout.panelShown() : true;
  }

  // the buttons: the gear in the corner, the star next to it toward the middle
  function buttons() {
    const v = host.view, size = hs.size, m = hs.margin;
    const right = hs.corner === 1 || hs.corner === 3, bottom = hs.corner >= 2;
    let y = m;
    if (bottom) {
      let edge = v.h;
      if (layout && layout.panelShown()) {
        edge = Math.min(edge, layout.panelTop());
        if (layout.tabShown() && layout.tabOnRight() === right) edge -= settings.tabSize.h;
      }
      y = edge - m - size;
    }
    const x = right ? v.w - m - size : m, step = (size + m) * (right ? -1 : 1);
    return { gear: { x, y, w: size, h: size }, star: { x: x + step, y, w: size, h: size } };
  }
  const hit = (r, s) => s.x >= r.x && s.y >= r.y && s.x < r.x + r.w && s.y < r.y + r.h;

  host.onFrame((dt) => {
    if (highlightLeft > 0) highlightLeft = roomInput() ? Math.max(0, highlightLeft - dt) : 0;
  });

  // ---------------------------------------------------------------- drawing

  function drawButton(ctx, r, kind) {
    ctx.fillStyle = st.background;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (st.borderWidth > 0) {
      ctx.lineWidth = st.borderWidth;
      ctx.strokeStyle = st.foreground;
      ctx.strokeRect(r.x + st.borderWidth / 2, r.y + st.borderWidth / 2, r.w - st.borderWidth, r.h - st.borderWidth);
    }
    const on = kind === "star" && highlightLeft > 0;
    const icon = icons[kind];
    if (icon) {
      // centered, 70% of the button, keeping its shape (the star's tinted while on)
      const side = r.w * 0.7, k = side / Math.max(icon.sw, icon.sh), w = icon.sw * k, h = icon.sh * k;
      ctx.save();
      if (on) ctx.filter = "sepia(1) saturate(4) brightness(1.1)";
      ctx.drawImage(icon.img, icon.sx, icon.sy, icon.sw, icon.sh, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
      ctx.restore();
      return;
    }
    const u = r.w / 64, cx = r.x + r.w / 2, cy = r.y + r.h / 2; // the drawings are made for 64 px
    if (kind === "gear") {
      ctx.strokeStyle = ctx.fillStyle = st.foreground;
      ctx.lineWidth = 8 * u;
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8, dx = Math.cos(a), dy = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(cx + dx * 14 * u, cy + dy * 14 * u);
        ctx.lineTo(cx + dx * 22 * u, cy + dy * 22 * u);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 15 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = st.backgroundOpaque;
      ctx.beginPath();
      ctx.arc(cx, cy, 7 * u, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = on ? st.accent : st.foreground;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8 - Math.PI / 2, rr = (i % 2 ? 7 : 22) * u;
        ctx[i ? "lineTo" : "moveTo"](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  // the room's interactive items: their shapes' bounding box, in room coordinates
  function itemBoxes() {
    const esc = host.esc, out = [];
    for (const o of esc.objects.values()) {
      const n = o.node;
      if (!isItem(n) || !o.interactive || !o.active || n.props.is_trigger || n === esc.player?.node) continue;
      if (!n.props.tooltip_name) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of itemShapes(n)) for (const q of s.pts) {
        const p = apply(s.xf, q);
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      if (x1 > x0) out.push({ name: game.tr(String(n.props.tooltip_name)), x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
    }
    return out;
  }

  function drawMarks(ctx) {
    const cam = host.esc.camera, a = Math.min(1, highlightLeft / 0.4); // fades out at the end
    const r = settings.marks.radius;
    ctx.save();
    ctx.globalAlpha = a;
    for (const it of itemBoxes()) {
      const p = cam ? apply(cam, it) : it;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = settings.marks.fill;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = settings.marks.ring;
      ctx.stroke();
      if (!hs.hintNames) continue;
      ctx.font = "bold 26px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#000";
      ctx.strokeText(it.name, p.x, p.y - r - 8);
      ctx.fillStyle = "#fff";
      ctx.fillText(it.name, p.x, p.y - r - 8);
    }
    ctx.restore();
  }

  host.onDraw((ctx) => {
    if (!roomInput()) return;
    if (highlightLeft > 0) drawMarks(ctx);
    const b = buttons();
    drawButton(ctx, b.gear, "gear");
    drawButton(ctx, b.star, "star");
  });

  return {
    /** Is s on a button (shown)? */
    covers: (s) => roomInput() && (hit(buttons().gear, s) || hit(buttons().star, s)),
    /** A tap: true if it was on a button (and did its job). */
    tap(s) {
      if (!roomInput()) return false;
      const b = buttons();
      if (hit(b.gear, s)) {
        host.key("Escape");
        return true;
      }
      if (hit(b.star, s)) {
        highlightLeft = highlightLeft > 0 ? 0 : hs.highlightSeconds;
        return true;
      }
      return false;
    },
  };
}
