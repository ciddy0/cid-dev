// Each line ends in a T: a stem out of the last station and a crossbar. The stem carries
// straight on unless that would run the T into another line or another T, in which case it
// swings round in 45° steps to the nearest heading that is clear, the line curving into it.
// Lines that end side by side at one station share a T instead, each bar stopping halfway to
// its neighbour.
import { lineEnds, segDist, toD } from "./geometry.js";
import { round } from "./math.js";

const TURNS = [0, 1, -1, 2, -2, 3, -3]; // headings to try, in 45° steps off straight on

// The T for every end of every line's main track, as { line, d, corners, trim }: the path data
// to stroke, the outer corners of its crossbar and, where the stem turns, the `trim` its track
// needs: the line itself stops at `from`, in place of track.pts[at], where the stem's arc takes
// over (or its square end would stick out of the curve).
export function termini(tracks, lane) {
  const stem = lane * 2.2,
    bar = lane * 1.4,
    skip = lane * 1.5; // the stem's first stretch sits under the station, where lines do meet

  const ends = tracks
    .filter((track) => !track.extra)
    .flatMap((track) =>
      lineEnds(track.pts).map((end, k) => ({
        ...end,
        line: track.line,
        track,
        at: k && track.pts.length - 1,
      })),
    );

  // The T at end `e`, its stem turned by `turn` 45° steps and its bar reaching this far each way.
  const tee = (e, turn, reach = [bar, bar]) => {
    const cos = Math.cos((turn * Math.PI) / 4),
      sin = Math.sin((turn * Math.PI) / 4);
    const dx = e.dx * cos - e.dy * sin,
      dy = e.dx * sin + e.dy * cos;
    const tip = [e.x + dx * stem, e.y + dy * stem];
    const cross = [
      [tip[0] + dy * reach[0], tip[1] - dx * reach[0]],
      [tip[0] - dy * reach[1], tip[1] + dx * reach[1]],
    ];
    // A stem that turns leaves the line on an arc taking up its first half.
    const cut = stem / 2;
    const from = [round(e.x - e.dx * cut), round(e.y - e.dy * cut)];
    return {
      from: turn ? from : null,
      segs: [[[e.x + dx * skip, e.y + dy * skip], tip], cross],
      corners: cross.flatMap(([x, y]) =>
        [1, -1].map((k) => [x + (k * dx * lane) / 2, y + (k * dy * lane) / 2]),
      ),
      d:
        toD(
          [from, [round(e.x), round(e.y)], tip.map(round)],
          [, cut / Math.tan((Math.abs(turn) * Math.PI) / 8)],
        ) +
        `M${round(cross[0][0])} ${round(cross[0][1])}L${round(cross[1][0])} ${round(cross[1][1])}`,
    };
  };

  const placed = []; // segments of the Ts settled so far
  return ends.map((e) => {
    // How far the bar can reach each side before meeting a neighbour ending alongside.
    const reach = [bar, bar];
    for (const o of ends) {
      const across = (o.y - e.y) * e.dx - (o.x - e.x) * e.dy,
        along = (o.x - e.x) * e.dx + (o.y - e.y) * e.dy;
      if (o.line === e.line || o.dx * e.dx + o.dy * e.dy < 0.99) continue;
      if (Math.abs(along) > lane / 2 || Math.abs(across) >= 2 * bar) continue;
      const side = across < 0 ? 0 : 1;
      reach[side] = Math.min(reach[side], Math.abs(across) / 2);
    }
    const shared = reach.some((v) => v < bar);

    // In the way: other lines, the straight-on stems of their ends, and the Ts already drawn.
    const blocks = [
      ...tracks
        .filter((t) => t.line !== e.line)
        .flatMap((t) => t.pts.slice(1).map((pt, i) => [t.pts[i], pt])),
      ...ends
        .filter((o) => o.line !== e.line)
        .map((o) => [
          [o.x, o.y],
          [o.x + o.dx * stem, o.y + o.dy * stem],
        ]),
      ...placed,
    ];
    const clear = (t) =>
      t.segs.every((a) => blocks.every((b) => segDist(a, b) > lane - 1e-6));
    const t =
      (!shared && TURNS.map((turn) => tee(e, turn)).find(clear)) || tee(e, 0, reach);
    placed.push(...t.segs);
    return {
      line: e.line,
      d: t.d,
      corners: t.corners,
      trim: t.from && { track: e.track, at: e.at, from: t.from },
    };
  });
}
