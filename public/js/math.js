// Small numeric helpers shared by the rest of the map.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

// To 3 decimals: plenty for a coordinate in schematic units, and short in an attribute.
export const round = (v) => +v.toFixed(3);

export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
