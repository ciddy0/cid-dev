// Where the trains are. A feed is a function from the time (in seconds) to a list of
// { id, line, from, to, progress, load }: a train of `line` between two neighbouring stations,
// `progress` (0 → 1) of the way along, carrying `load`, up to SEATS passengers, each a shape
// from SHAPES. This one comes from the timetable; the live one in live.js returns the same
// thing.
import { clamp, easeInOutQuad } from "./math.js";

const SPEED = 40; // timetable seconds per real second
const DWELL = 20; // timetable seconds a train stands at each station
const TURN = 180; // and at the end of the line before heading back
export const SEATS = 6; // passengers a car holds, two abreast
export const SHAPES = ["circle", "triangle", "square"];

// A line's two runs, out and back, each a list of hops between neighbouring stations: who from,
// who to, when (timetable seconds into the run) and the `legs` of track ridden, as
// [rail, from, to]. The way back takes the line's extra paths, which are the stations only
// served in that direction, joining and leaving the main track where the two meet. `rails` maps
// each track to its rail.
export function runs(line, tracks, rails) {
  const [main, ...extras] = tracks.filter((t) => t.line === line);
  const stop = (track, k, t) => ({
    id: track.part.stations[k],
    rail: rails.get(track),
    s: rails.get(track).len(track.part.at[k]),
    t,
  });
  const out = line.stations.map((_, k) => stop(main, k, line.times[k]));
  const back = out.map((s) => ({ ...s, t: line.times.at(-1) - s.t })).reverse();
  for (const extra of extras) {
    const ids = extra.part.stations,
      at = extra.part.at;
    const a = back.findIndex((s) => s.id === ids.at(-1)),
      b = back.findIndex((s) => s.id === ids[0]);
    if (a < 0 || b < a) continue;
    // No times of their own: spread over the stretch of main line they stand in for.
    const t = (k) => back[b].t + ((back[a].t - back[b].t) * at[k]) / at.at(-1);
    const stops = ids.map((_, k) => stop(extra, k, t(k))).reverse();
    stops[0].tip = rails.get(extra).total; // the ends of the extra's rail, where it meets the main one
    stops.at(-1).tip = 0;
    back.splice(a, b - a + 1, ...stops);
  }
  const legs = (p, q) => {
    if (p.rail === q.rail) return [[p.rail, p.s, q.s]];
    if (q.tip != null)
      return [
        [p.rail, p.s, p.rail.near(q.rail.at(q.tip))],
        [q.rail, q.tip, q.s],
      ];
    return [
      [p.rail, p.s, p.tip],
      [q.rail, q.rail.near(p.rail.at(p.tip)), q.s],
    ];
  };
  return [out, back].map((stops) =>
    stops.slice(1).map((q, k) => {
      const p = stops[k];
      return { from: p.id, to: q.id, dep: p.t, arr: q.t, legs: legs(p, q) };
    }),
  );
}

// The passengers of train number `train` after `stop` stops. They are made up: each seat's rider
// stays on for a few stops, then leaves it to another or to nobody.
const dice = (...seed) =>
  seed.reduce((h, v) => Math.imul(h ^ v, 0x9e3779b1) ^ (h >>> 15), 0x2545f491) >>> 8;
export const riders = (train, stop) =>
  Array.from({ length: SEATS }, (_, seat) => {
    const roll = dice(train, seat, Math.floor((stop + seat * 2) / (3 + seat)));
    return roll % 5 < 3 ? [SHAPES[(roll >> 4) % SHAPES.length]] : [];
  }).flat();

// The timetable as a feed, for `routes` of { line, runs }. Every train shuttles end to end and
// back for ever, enough of them a line to keep its daytime frequency, evenly spaced. Between two
// stations a train stands for DWELL, then eases out and into the next one. Worked out from the
// clock alone, so there is nothing to keep in step.
export function scheduled(routes) {
  return (now) =>
    routes.flatMap(({ line, runs }, r) => {
      const lap = runs[0].at(-1).arr + TURN,
        count = Math.max(1, Math.round((2 * lap * line.trainsPerHour) / 3600));
      return Array.from({ length: count }, (_, k) => {
        const clock = now * SPEED + (k * 2 * lap) / count,
          t = clock % (2 * lap),
          run = runs[t < lap ? 0 : 1];
        const hop = run.findLast((h) => h.dep <= t % lap);
        const stops = Math.floor(clock / lap) * run.length + run.indexOf(hop); // made so far
        const moved = (t % lap - hop.dep - DWELL) / (hop.arr - hop.dep - DWELL);
        return {
          id: `${line.id}-${k}`,
          line: line.id,
          from: hop.from,
          to: hop.to,
          progress: easeInOutQuad(clamp(moved, 0, 1)),
          load: riders(r * 1000 + k, stops),
        };
      });
    });
}
