// Polyline geometry for the lines: rounding their bends off into arcs, and measuring around
// them. Points are [x, y] in schematic units. Nothing here touches the page, so it runs (and is
// tested) under Node as well.
import { round } from "./math.js";

// The bend at pts[i]: unit directions in and out, the unit bisector pointing into the turn, half
// the angle turned through and the largest radius both legs have room for. Null where the line
// ends or runs straight on.
export function bendAt(pts, i) {
  const prev = pts[i - 1],
    next = pts[i + 1];
  if (!prev || !next) return null;
  const [x, y] = pts[i];
  const inLen = Math.hypot(x - prev[0], y - prev[1]),
    outLen = Math.hypot(next[0] - x, next[1] - y);
  const u = [(x - prev[0]) / inLen, (y - prev[1]) / inLen],
    v = [(next[0] - x) / outLen, (next[1] - y) / outLen];
  const cross = u[0] * v[1] - u[1] * v[0];
  const half = Math.atan2(Math.abs(cross), u[0] * v[0] + u[1] * v[1]) / 2;
  if (half < 1e-3 || half > 1.5) return null;
  const k = 2 * Math.sin(half);
  return {
    x,
    y,
    u,
    v,
    n: [(v[0] - u[0]) / k, (v[1] - u[1]) / k],
    half,
    cw: cross > 0,
    room: Math.min(inLen, outLen) / 2 / Math.tan(half),
  };
}

// Arc radius for every bend of every track, as one array per track. A bend on its own starts
// and ends `cut` from its corner. Lines going round a bend side by side share the arc's centre
// instead, the inner one turning tighter than the outer, so they stay touching all the way round.
export function bendRadii(tracks, cut, lane) {
  const bends = tracks.flatMap(({ pts }, t) =>
    pts.flatMap((_, i) => {
      const b = bendAt(pts, i);
      return b ? [{ ...b, t, i, r: cut / Math.tan(b.half) }] : [];
    }),
  );
  const radii = tracks.map(() => []);
  const done = new Set();
  for (const b of bends) {
    if (done.has(b)) continue;
    // Its neighbours: the same turn, with the corner a few lanes along the bisector. `d` is how
    // far further into the turn each one runs.
    const group = bends.flatMap((g) => {
      const dx = g.x - b.x,
        dy = g.y - b.y;
      const same =
        g === b ||
        (!done.has(g) &&
          g.t !== b.t &&
          g.u[0] * b.u[0] + g.u[1] * b.u[1] > 0.999 &&
          g.v[0] * b.v[0] + g.v[1] * b.v[1] > 0.999 &&
          Math.abs(dx * b.n[1] - dy * b.n[0]) < 1e-3 &&
          Math.hypot(dx, dy) < 4 * lane);
      return same ? [{ g, d: (dx * b.n[0] + dy * b.n[1]) * Math.cos(b.half) }] : [];
    });
    const mid = group.reduce((sum, { d }) => sum + d, 0) / group.length;
    const rs = group.map(({ g, d }) => g.r - (d - mid));
    // Tighten the whole bundle if a short leg leaves one of its lines no room for its arc.
    const over = Math.max(0, ...group.map(({ g }, k) => rs[k] - g.room));
    group.forEach(({ g }, k) => {
      radii[g.t][g.i] = Math.max(0, rs[k] - over);
      done.add(g);
    });
  }
  return radii;
}

// Polyline → path data with the bend at each pts[i] rounded off by an arc of radius radii[i].
export function toD(pts, radii = []) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i],
      r = radii[i],
      b = r && bendAt(pts, i);
    if (!b) {
      d += `L${x} ${y}`;
      continue;
    }
    const cut = r * Math.tan(b.half);
    d +=
      `L${round(x - b.u[0] * cut)} ${round(y - b.u[1] * cut)}` +
      `A${round(r)} ${round(r)} 0 0 ${+b.cw} ${round(x + b.v[0] * cut)} ${round(y + b.v[1] * cut)}`;
  }
  return d;
}

// How far rounding pulls the line off the corner at pts[i]: the arc's midpoint, relative to
// the corner. A station on a bend has to move by this much to stay on its line.
export function bendShift(pts, i, r) {
  const b = r && bendAt(pts, i);
  if (!b) return [0, 0];
  const k = r * (1 / Math.cos(b.half) - 1);
  return [b.n[0] * k, b.n[1] * k];
}

// Shortest distance between two segments, each [[x, y], [x, y]]; 0 if they cross.
export function segDist([p, q], [r, s]) {
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  if (
    cross(p, q, r) * cross(p, q, s) < 0 &&
    cross(r, s, p) * cross(r, s, q) < 0
  )
    return 0;
  const toSeg = (pt, a, b) => {
    const vx = b[0] - a[0],
      vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy;
    const t = len2
      ? Math.max(
          0,
          Math.min(1, ((pt[0] - a[0]) * vx + (pt[1] - a[1]) * vy) / len2),
        )
      : 0;
    return Math.hypot(pt[0] - a[0] - t * vx, pt[1] - a[1] - t * vy);
  };
  return Math.min(
    toSeg(p, r, s),
    toSeg(q, r, s),
    toSeg(r, p, q),
    toSeg(s, p, q),
  );
}

// Both ends of a polyline: the terminal point and the unit direction the line arrives in.
export function lineEnds(pts) {
  const end = ([x, y], [px, py]) => {
    const len = Math.hypot(x - px, y - py);
    return { x, y, dx: (x - px) / len, dy: (y - py) / len };
  };
  return pts.length < 2 ? [] : [end(pts[0], pts[1]), end(pts.at(-1), pts.at(-2))];
}

// A bounding box that grows to take in whatever it is told about.
export function bounds() {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  return {
    // Take in the point (x, y), or the disc of radius r around it.
    cover(x, y, r = 0) {
      b.minX = Math.min(b.minX, x - r);
      b.minY = Math.min(b.minY, y - r);
      b.maxX = Math.max(b.maxX, x + r);
      b.maxY = Math.max(b.maxY, y + r);
    },
    // The box as { x, y, w, h }, with `pad` of clear space all round.
    box: (pad = 0) => ({
      x: b.minX - pad,
      y: b.minY - pad,
      w: b.maxX - b.minX + 2 * pad,
      h: b.maxY - b.minY + 2 * pad,
    }),
  };
}
