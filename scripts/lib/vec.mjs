// 2D vectors as [x, y], x east and y south, and the eight compass directions lines may run in.
export const EPS = 1e-6;

export const COMPASS = { E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1], N: [0, -1], NE: [1, -1] };
export const DIR8 = Object.values(COMPASS);

export const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const len = (v) => Math.hypot(v[0], v[1]);
export const dist = (a, b) => len(sub(a, b));
export const unit = (v) => [v[0] / len(v), v[1] / len(v)];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
// Signed turn from a to b; positive = to the right as drawn (y points down).
export const turn = (a, b) => Math.atan2(cross(a, b), dot(a, b));
// Unsigned turn from a to b; 0 if either is missing or has no length.
export const angle = (a, b) => (a && b && len(a) > EPS && len(b) > EPS ? Math.abs(turn(a, b)) : 0);
// To 3 decimals, with -0 tidied to 0.
export const r3 = (n) => Math.round(n * 1000) / 1000 + 0;
export const isOctilinear = (v, tol = EPS) =>
  Math.abs(v[0]) < tol || Math.abs(v[1]) < tol || Math.abs(Math.abs(v[0]) - Math.abs(v[1])) < tol;
