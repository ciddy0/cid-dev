// Small numeric helpers shared by the rest of the map.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

// To 3 decimals: plenty for a coordinate in schematic units, and short in an attribute.
export const round = (v) => +v.toFixed(3);

// A CSS cubic-bezier(x1, y1, x2, y2) as a function of 0 → 1.
export function bezier(x1, y1, x2, y2) {
  const curve = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 24; i++) {
      const t = (lo + hi) / 2;
      if (curve(x1, x2, t) < x) lo = t;
      else hi = t;
    }
    return curve(y1, y2, (lo + hi) / 2);
  };
}

export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
