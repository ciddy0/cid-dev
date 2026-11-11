import { el } from "./dom.js";
import { bendAt, toD } from "./geometry.js";
import { clamp } from "./math.js";

const STEP = 0.05; // schematic units between the points a rail is sampled at

// A track to ride. `at(s)` is the point `s` along its rounded path, `len(d)` turns a distance
// along the unrounded polyline (what metro.json's `at` measures) into such an `s`, and
// `near(p)` is the `s` of the point closest to p. `parent` is any <g> in the map's <svg>: the
// path is measured there, never painted.
export function rail({ pts, radii }, parent) {
  const path = el("path", { d: toD(pts, radii) }, parent);
  const total = path.getTotalLength(),
    n = Math.ceil(total / STEP);
  const xy = Array.from({ length: n + 1 }, (_, i) => {
    const p = path.getPointAtLength((i / n) * total);
    return [p.x, p.y];
  });
  path.remove();

  let run = 0;
  const bends = pts.flatMap((p, i) => {
    if (i) run += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const b = radii[i] && bendAt(pts, i);
    return b ? [{ d: run, cut: radii[i] * Math.tan(b.half), arc: radii[i] * b.half }] : [];
  });
  return {
    total,
    at(s) {
      const f = clamp(s / total, 0, 1) * n,
        i = Math.min(n - 1, Math.floor(f));
      return [0, 1].map((k) => xy[i][k] + (xy[i + 1][k] - xy[i][k]) * (f - i));
    },
    // Each bend swaps `cut` of straight either side of its corner for a shorter arc.
    len: (d) =>
      bends.reduce(
        (s, b) => s - (clamp(d - b.d, -b.cut, b.cut) + b.cut) * (1 - b.arc / b.cut),
        d,
      ),
    near([x, y]) {
      const gap = xy.map((p) => Math.hypot(p[0] - x, p[1] - y));
      return (gap.indexOf(Math.min(...gap)) / n) * total;
    },
  };
}
