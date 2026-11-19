// Path finding on NavigationPolygon meshes, like NavigationServer2D.map_get_path
// with optimize = true: the start and end points are moved to the closest
// point of the mesh, an A* over the polygons (entering each one at the closest
// point of the shared edge, as Godot does) finds the corridor, and the funnel
// algorithm ("string pulling") turns it into the shortest path.
import { apply } from "./render.js";
import { points, list } from "./values.js";

const key = (p) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// twice the signed area of a, b, c (> 0: c is to the right of a->b on screen, y down)
const area2 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);

function closestOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function insidePolygon(p, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

export class NavMesh {
  /** @param regions [{xf, polygon: NavigationPolygon resource}] (global transform of each region) */
  constructor(regions) {
    this.polys = []; // {pts: [{x,y}], links: [{to, a, b}]}
    const edges = new Map(); // "p|q" -> [poly index, a, b]
    for (const { xf, polygon } of regions) {
      const verts = points(polygon.props.vertices).map((v) => apply(xf, v));
      for (const idx of polygon.props.polygons || []) {
        const pts = list(idx).map((i) => verts[i]);
        const pi = this.polys.length;
        this.polys.push({ pts, links: [] });
        // polygons that share an edge (same two points) are connected
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const k1 = `${key(a)}|${key(b)}`, k2 = `${key(b)}|${key(a)}`;
          const other = edges.get(k2) || edges.get(k1);
          if (other && other[0] !== pi) {
            this.polys[pi].links.push({ to: other[0], a, b });
            this.polys[other[0]].links.push({ to: pi, a: other[1], b: other[2] });
          } else edges.set(k1, [pi, a, b]);
        }
      }
    }
  }

  get empty() {
    return this.polys.length === 0;
  }

  /** Closest point of the mesh to p, and the polygon it is in: {p, poly}. */
  closest(p) {
    let best = null;
    for (let i = 0; i < this.polys.length; i++) {
      const pts = this.polys[i].pts;
      if (insidePolygon(p, pts)) return { p: { x: p.x, y: p.y }, poly: i };
      for (let j = 0; j < pts.length; j++) {
        const q = closestOnSegment(p, pts[j], pts[(j + 1) % pts.length]);
        const d = dist(p, q);
        if (!best || d < best.d) best = { p: q, poly: i, d };
      }
    }
    return best && { p: best.p, poly: best.poly };
  }

  /** Shortest path from `from` to `to` ([] if there is none). */
  path(from, to) {
    if (this.empty) return [];
    const s = this.closest(from), e = this.closest(to);
    if (s.poly === e.poly) return [s.p, e.p];

    // A* over polygons; each polygon is entered at the point of the shared
    // edge closest to where the previous one was entered
    const open = new Map([[s.poly, { g: 0, f: dist(s.p, e.p), at: s.p, prev: null, via: null }]]);
    const done = new Map();
    while (open.size) {
      let cur = null, ci = -1;
      for (const [i, n] of open) if (!cur || n.f < cur.f) (cur = n), (ci = i);
      open.delete(ci);
      done.set(ci, cur);
      if (ci === e.poly) break;
      for (const l of this.polys[ci].links) {
        if (done.has(l.to)) continue;
        const at = closestOnSegment(cur.at, l.a, l.b);
        const g = cur.g + dist(cur.at, at);
        const old = open.get(l.to);
        if (!old || g < old.g) open.set(l.to, { g, f: g + dist(at, e.p), at, prev: ci, via: l });
      }
    }
    if (!done.has(e.poly)) return [];

    // corridor of portals, from start to end
    const portals = [];
    for (let i = e.poly; done.get(i).prev !== null; i = done.get(i).prev) portals.unshift({ link: done.get(i).via, from: done.get(i).prev });
    return funnel(s.p, e.p, portals.map(({ link }) => orient(link)));
  }
}

// Shared edge of two polygons as a portal; funnel() sorts out which end is
// left and which right.
function orient(link) {
  return { left: link.a, right: link.b };
}

// Simple stupid funnel algorithm (Mikko Mononen), in screen coordinates.
function funnel(start, end, portals) {
  if (portals.length) {
    // make every portal left/right consistent with the walking direction
    const mid = (p) => ({ x: (p.left.x + p.right.x) / 2, y: (p.left.y + p.right.y) / 2 });
    let prev = start;
    for (const p of portals) {
      // the funnel below uses Mononen's convention (y up): on screen (y down)
      // its "left" side is the one with area2 > 0
      if (area2(prev, mid(p), p.left) < 0) [p.left, p.right] = [p.right, p.left];
      prev = mid(p);
    }
  }
  portals.push({ left: end, right: end });
  const path = [start];
  let apex = start, left = start, right = start;
  let apexIdx = 0, leftIdx = 0, rightIdx = 0;
  for (let i = 0; i < portals.length; i++) {
    const pl = portals[i].left, pr = portals[i].right;
    // narrow the right side
    if (area2(apex, right, pr) >= 0) {
      if (apex === right || area2(apex, left, pr) < 0) {
        right = pr;
        rightIdx = i;
      } else {
        path.push(left);
        apex = left;
        apexIdx = leftIdx;
        left = right = apex;
        leftIdx = rightIdx = apexIdx;
        i = apexIdx;
        continue;
      }
    }
    // narrow the left side
    if (area2(apex, left, pl) <= 0) {
      if (apex === left || area2(apex, right, pl) > 0) {
        left = pl;
        leftIdx = i;
      } else {
        path.push(right);
        apex = right;
        apexIdx = rightIdx;
        left = right = apex;
        leftIdx = rightIdx = apexIdx;
        i = apexIdx;
        continue;
      }
    }
  }
  const last = path[path.length - 1];
  if (last.x !== end.x || last.y !== end.y) path.push(end);
  return path;
}
