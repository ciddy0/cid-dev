export const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

export const round = (v) => +v.toFixed(3);

export const easeInOutQuad = (t) =>
  t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
