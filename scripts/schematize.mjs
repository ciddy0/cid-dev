// Turns the geographic network from build-map.mjs into a schematic one: stations on a loose grid,
// every segment at 0/45/90/135°, lines that share track drawn side by side.
//
// Units: 1 = the nominal gap between neighbouring stations. x east, y south. Parallel lines sit
// LANE apart, and the layout assumes they are stroked about LANE wide.
//
// How it works
//   1. Place stations. Pinned stations (data/overrides.json) go where they're told. Unpinned
//      stations between two placed ones on a line are spread evenly along the route between them.
//      Anything left over (a new extension past a pinned terminal, a whole new line) walks outward
//      one unit per stop in the compass direction closest to its real bearing.
//   2. Route each station-to-station hop: straight if it already is octilinear, otherwise one bend
//      (a diagonal leg plus a straight leg; which comes first is picked to follow the real bearing
//      and to avoid kinks at the stations either side).
//   3. Give lines that share track a lane each. Which line goes on which side is worked out from
//      where they peel away at the ends of the shared stretch, so they don't cross. A lane is kept
//      to the end of the straight it is on, so a line never jogs sideways mid-straight.
//   4. Offset each line's path into its lane and read off where it stops at each station.
//
// data/overrides.json — all keys optional. Stations are named by GTFS id ("80122S") or exact name
// ("7th Street / Metro Center"); check the names in public/data/metro.json.
//   "pins":   { "Union": [4, -2] }
//             Put a station here. This is the centre of the track before lanes are applied, so a
//             station on shared track can end up drawn up to a lane or so from its pin.
//   "nudges": { "Soto": [0.5, 0] }
//             Move an unpinned station by this much from wherever step 1 put it.
//   "bends":  { "Pacific Ave > Anaheim Street": "N-E" }
//             Force the bend between two stations: leave the first heading N, arrive at the second
//             heading E (N NE E SE S SW W NW; the second direction may be left out). The two
//             stations are neighbours on a line, or the placed stations either side of a run of
//             unpinned ones.
//   "sides":  [["E", "A"]]
//             Where these lines share track, the first is on the left, facing the way the first
//             line's station list runs. Only needed when the automatic choice is wrong or a tie.
//   "shifts": [{ "lines": ["B", "D"], "at": "7th Street / Metro Center", "by": -2 }]
//             Slide the straights of these lines that touch this station sideways by this many
//             lanes (positive = right of the direction of travel, negative = left). For stations
//             where two bundles of lines touch without crossing and should sit next to each other
//             instead of on top of each other. The shifted lines' stops are then slid along the
//             track to line up with the station's other stops, so the marker is one straight pill.

export const LANE = 0.2; // gap between parallel lines, and the stroke width the layout assumes
export const MIN_SPACING = 0.9; // station centres closer than this are reported
const SEED_SCALE = 0.6; // km → units, only used to seed a line with no placed station at all
const EPS = 1e-6;

const COMPASS = { E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1], N: [0, -1], NE: [1, -1] };
const DIR8 = Object.values(COMPASS);

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const dist = (a, b) => len(sub(a, b));
const unit = (v) => [v[0] / len(v), v[1] / len(v)];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
// Signed turn from a to b; positive = to the right as drawn (y points down).
const turn = (a, b) => Math.atan2(cross(a, b), dot(a, b));
const angle = (a, b) => (a && b && len(a) > EPS && len(b) > EPS ? Math.abs(turn(a, b)) : 0);
const r3 = (n) => Math.round(n * 1000) / 1000 + 0;
const isOctilinear = (v, tol = EPS) =>
  Math.abs(v[0]) < tol || Math.abs(v[1]) < tol || Math.abs(Math.abs(v[0]) - Math.abs(v[1])) < tol;

// One-bend route leaving a along d1 and arriving at b along d2, or null if they don't meet.
function forced(a, b, d1, d2) {
  const d = sub(b, a);
  const options = (d2 ? [d2] : DIR8).filter((v) => Math.abs(cross(d1, v)) > EPS).map((v) => {
    const det = cross(d1, v), t1 = cross(d, v) / det, t2 = cross(d1, d) / det;
    return { t1, t2, bend: add(a, d1, t1), turn: angle(d1, v) };
  }).filter((o) => o.t1 > EPS && o.t2 > -EPS).sort((p, q) => p.turn - q.turn);
  if (!options.length) return null;
  return options[0].t2 < EPS ? [a, b] : [a, options[0].bend, b];
}

// Octilinear route from a to b with at most one bend. hint: geoIn/geoOut are the real bearings
// leaving a / arriving at b, prev/next the schematic points before a / after b.
function route(a, b, hint = {}) {
  const d = sub(b, a);
  if (isOctilinear(d)) return [a, b];
  const m = Math.min(Math.abs(d[0]), Math.abs(d[1]));
  const diag = [Math.sign(d[0]) * m, Math.sign(d[1]) * m], rest = sub(d, diag);
  const cost = ([u, v]) => angle(u, hint.geoIn) + angle(v, hint.geoOut)
    + 0.5 * (hint.prev ? angle(sub(a, hint.prev), u) : 0) + 0.5 * (hint.next ? angle(v, sub(hint.next, b)) : 0);
  const [first] = [[diag, rest], [rest, diag]].sort((p, q) => cost(p) - cost(q));
  return [a, add(a, first[0]), b];
}

export function schematize(lines, stations, overrides = {}) {
  const problems = [];
  const byName = Map.groupBy(Object.keys(stations), (id) => stations[id].name);
  const idOf = (key) => {
    key = key.trim();
    if (stations[key]) return key;
    const ids = byName.get(key) ?? [];
    if (ids.length !== 1) problems.push(`overrides: ${ids.length ? "ambiguous" : "unknown"} station "${key}"`);
    return ids.length === 1 ? ids[0] : null;
  };
  const keyed = (obj) => new Map(Object.entries(obj ?? {}).map(([k, v]) => [idOf(k), v]).filter(([k]) => k));

  const bends = new Map();
  for (const [key, value] of Object.entries(overrides.bends ?? {})) {
    const [a, b] = key.split(">").map(idOf), dirs = value.split("-").map((c) => COMPASS[c.trim()]);
    if (a && b && dirs[0] && dirs.every(Boolean)) bends.set(`${a}>${b}`, dirs);
    else problems.push(`overrides: bad bend "${key}": "${value}"`);
  }

  const paths = lines.flatMap((l) => [l.stations, ...l.extraPaths]);
  const geo = (id) => [stations[id].x, stations[id].y];

  // --- 1. place stations, remembering the bend (if any) inside each hop
  function place(pins) {
    const pos = new Map(pins), via = new Map();
    const setVia = (a, b, pts) => { via.set(`${a}>${b}`, pts); via.set(`${b}>${a}`, pts.toReversed()); };

    const routeBetween = (path, i, j) => {
      const [a, b] = [path[i], path[j]], [pa, pb] = [pos.get(a), pos.get(b)];
      const fwd = bends.get(`${a}>${b}`), back = bends.get(`${b}>${a}`);
      const r = fwd ? forced(pa, pb, ...fwd) : back ? forced(pb, pa, ...back)?.toReversed() : null;
      if ((fwd || back) && !r) problems.push(`overrides: bend ${stations[a].name} > ${stations[b].name} can't be drawn that way`);
      return r ?? route(pa, pb, {
        geoIn: sub(geo(path[i + 1]), geo(a)), geoOut: sub(geo(b), geo(path[j - 1])),
        prev: pos.get(path[i - 1]), next: pos.get(path[j + 1]),
      });
    };

    // Spread path[i+1..j-1] evenly along the route between the placed stations path[i] and path[j].
    const span = (path, i, j) => {
      const r = routeBetween(path, i, j);
      const leg = dist(r[0], r[1]), total = leg + (r[2] ? dist(r[1], r[2]) : 0), step = total / (j - i);
      const at = (t) => (t <= leg ? add(r[0], unit(sub(r[1], r[0])), t) : add(r[1], unit(sub(r[2], r[1])), t - leg));
      for (let k = i + 1; k < j; k++) pos.set(path[k], at(step * (k - i)));
      for (let k = i; k < j; k++) {
        const inside = r[2] && leg > step * (k - i) + EPS && leg < step * (k - i + 1) - EPS;
        setVia(path[k], path[k + 1], inside ? [r[1]] : []);
      }
    };

    // Walk an unplaced end of a line outward from index k, one unit per stop, keeping the current
    // compass direction until the real bearing has clearly swung away from it.
    const walk = (path, k, step) => {
      let heading = null;
      for (k += step; path[k] && !pos.has(path[k]); k += step) {
        const real = sub(geo(path[k]), geo(path[k - step]));
        if (!heading || angle(heading, real) > 0.6) heading = DIR8.toSorted((p, q) => angle(p, real) - angle(q, real))[0];
        pos.set(path[k], add(pos.get(path[k - step]), heading));
      }
    };

    for (;;) {
      let progress = false;
      for (const path of paths) {
        let last = -1;
        path.forEach((id, k) => {
          if (!pos.has(id)) return;
          if (last >= 0 && k - last > 1) { span(path, last, k); progress = true; }
          last = k;
        });
      }
      if (progress) continue;
      const path = paths.find((p) => p.some((id) => !pos.has(id)));
      if (!path) break;
      if (!path.some((id) => pos.has(id))) pos.set(path[0], geo(path[0]).map((v) => Math.round(v * SEED_SCALE)));
      walk(path, path.findLastIndex((id) => pos.has(id)), 1);
      walk(path, path.findIndex((id) => pos.has(id)), -1);
    }
    for (const path of paths) {
      for (let k = 0; k < path.length - 1; k++) {
        if (!via.has(`${path[k]}>${path[k + 1]}`)) setVia(path[k], path[k + 1], routeBetween(path, k, k + 1).slice(1, -1));
      }
    }
    return { pos, via };
  }

  const pins = keyed(overrides.pins), nudges = keyed(overrides.nudges);
  let { pos, via } = place(pins);
  if (nudges.size) {
    for (const [id, d] of nudges) pins.set(id, add(pos.get(id), d));
    ({ pos, via } = place(pins));
  }

  // --- 2. centre path of each line: station vertices with the bends between them
  const centre = (path) => {
    const verts = [];
    path.forEach((id, k) => {
      verts.push({ p: pos.get(id), station: k });
      for (const p of via.get(`${id}>${path[k + 1]}`) ?? []) verts.push({ p, hop: k });
    });
    const segs = [];
    let hop = 0;
    for (let k = 0; k < verts.length - 1; k++) {
      if (verts[k].station !== undefined) hop = verts[k].station;
      const d = sub(verts[k + 1].p, verts[k].p);
      if (len(d) < EPS) problems.push(`${stations[path[hop]].name} and ${stations[path[hop + 1]].name} are on top of each other`);
      segs.push({ dir: unit(d), hop, lane: null, shift: 0 });
    }
    return { verts, segs };
  };
  const main = new Map(lines.map((l) => [l.id, centre(l.stations)]));
  // Direction a line leaves station index i towards index i + step.
  const leave = (l, i, step) => {
    const { verts, segs } = main.get(l.id), v = verts.findIndex((x) => x.station === i);
    const s = segs[step > 0 ? v : v - 1];
    return s ? [s.dir[0] * step, s.dir[1] * step] : null;
  };

  // --- 3. lanes. For each pair of lines, walk their shared stretches and vote on who is on the left.
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const sides = (overrides.sides ?? []).filter(([a, b]) => (lineById.has(a) && lineById.has(b)) || void problems.push(`overrides: unknown line in sides ${a}, ${b}`));
  const edges = new Map(); // "a>b" (ids sorted) → [{ line, hop, fwd }]
  const leftOf = new Map(); // "P>Q>edge" → true if P is left of Q in the edge's sorted direction
  for (const l of lines) {
    l.stations.slice(0, -1).forEach((a, hop) => {
      const b = l.stations[hop + 1], key = a < b ? `${a}>${b}` : `${b}>${a}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ line: l, hop, fwd: a < b });
    });
  }
  for (const P of lines) {
    for (const Q of lines) {
      if (P.id >= Q.id) continue;
      const qi = new Map(Q.stations.map((id, i) => [id, i]));
      const shared = (i) => Math.abs(qi.get(P.stations[i]) - qi.get(P.stations[i + 1])) === 1;
      for (let i = 0; i < P.stations.length - 1; i++) {
        if (!shared(i)) continue;
        let j = i + 1;
        while (j < P.stations.length - 1 && shared(j)) j++;
        const qdir = Math.sign(qi.get(P.stations[i + 1]) - qi.get(P.stations[i]));
        // At each end, facing out of the shared stretch: whoever turns further left is on the left.
        const vote = (pIdx, step) => {
          const back = leave(P, pIdx, -step), p = leave(P, pIdx, step), q = leave(Q, qi.get(P.stations[pIdx]), step * qdir);
          const facing = [-back[0], -back[1]];
          return p && q ? Math.sign(turn(facing, q) - turn(facing, p)) * step : 0;
        };
        const votes = vote(j, 1) + vote(i, -1);
        const forcedSide = sides.find((s) => s.includes(P.id) && s.includes(Q.id));
        const pLeft = forcedSide ? forcedSide[0] === P.id || qdir < 0 : votes >= 0;
        for (let k = i; k < j; k++) {
          const [a, b] = [P.stations[k], P.stations[k + 1]];
          leftOf.set(`${P.id}>${Q.id}>${a < b ? `${a}>${b}` : `${b}>${a}`}`, pLeft === a < b);
        }
        i = j - 1;
      }
    }
  }
  for (const [key, users] of edges) {
    if (users.length < 2) continue;
    const left = (u, v) => (u.line.id < v.line.id ? leftOf.get(`${u.line.id}>${v.line.id}>${key}`) : !leftOf.get(`${v.line.id}>${u.line.id}>${key}`));
    users.sort((u, v) => (left(u, v) ? -1 : 1));
    users.forEach((u, n) => {
      const lane = (n - (users.length - 1) / 2) * (u.fwd ? 1 : -1);
      for (const s of main.get(u.line.id).segs) if (s.hop === u.hop) s.lane = lane;
    });
  }

  // A straight keeps the lane of its shared part from end to end (no sideways jog where the other
  // line peels off). Shifts from the overrides apply to whole straights too.
  const runsOf = (segs) => {
    const runs = [];
    segs.forEach((s, k) => (k && dist(s.dir, segs[k - 1].dir) < EPS ? runs.at(-1).push(s) : runs.push([s])));
    return runs;
  };
  for (const { segs } of main.values()) {
    for (const run of runsOf(segs)) {
      for (const order of [run, run.toReversed()]) order.forEach((s, k) => { if (s.lane === null && k) s.lane = order[k - 1].lane; });
    }
  }
  for (const sh of overrides.shifts ?? []) {
    const at = idOf(sh.at);
    for (const id of sh.lines ?? []) {
      const l = lineById.get(id), i = l?.stations.indexOf(at) ?? -1;
      if (i < 0) { problems.push(`overrides: shift of ${id} at "${sh.at}" matches nothing`); continue; }
      const { verts, segs } = main.get(id), v = verts.findIndex((x) => x.station === i);
      for (const run of runsOf(segs)) if (run.includes(segs[v]) || run.includes(segs[v - 1])) for (const s of run) s.shift += sh.by;
    }
  }

  // --- 4. offset the centre path into its lane
  const offsetPath = ({ verts, segs }) => {
    const off = (s) => ((s.lane ?? 0) + s.shift) * LANE;
    const side = (p, s) => add(p, [-s.dir[1], s.dir[0]], off(s)); // right of travel
    const pts = [], stops = [];
    verts.forEach(({ p, station }, k) => {
      const [s0, s1] = [segs[k - 1], segs[k]];
      let here;
      if (!s0 || !s1) here = [side(p, s0 ?? s1)];
      else if (Math.abs(cross(s0.dir, s1.dir)) > EPS) {
        const a = side(p, s0), b = side(p, s1);
        here = [add(a, s0.dir, cross(sub(b, a), s1.dir) / cross(s0.dir, s1.dir))];
      } else if (Math.abs(off(s0) - off(s1)) < EPS) here = [side(p, s0)];
      else here = [side(p, s0), add(side(p, s1), s1.dir, Math.abs(off(s0) - off(s1)))]; // 45° lane change
      if (station !== undefined) stops.push(here[0].map(r3));
      pts.push(...here.map((q) => q.map(r3)));
    });
    // Drop vertices in the middle of a straight.
    const path = pts.filter((q, k) => !k || k === pts.length - 1
      || Math.abs(cross(unit(sub(q, pts[k - 1])), unit(sub(pts[k + 1], q)))) > 1e-3);
    return { path, stops };
  };
  const onSegment = (q, a, b) => {
    const d = sub(b, a), t = dot(sub(q, a), d) / dot(d, d);
    return t > -1e-3 && t < 1 + 1e-3 && Math.abs(cross(sub(q, a), unit(d))) < 2e-3 ? t : null;
  };
  // Distance along the path to each stop, checking the path on the way.
  const measure = ({ path, stops }, ids) => {
    const name = `${stations[ids[0]].name} → ${stations[ids.at(-1)].name}`;
    let k = 0, run = 0;
    const at = stops.map((q) => {
      for (; k < path.length - 1; run += dist(path[k], path[k + 1]), k++) {
        const t = onSegment(q, path[k], path[k + 1]);
        if (t !== null) return r3(run + t * dist(path[k], path[k + 1]));
      }
      problems.push(`${name}: a stop is off the path (stations too close to a bend?)`);
      return r3(run);
    });
    path.slice(1).forEach((q, n) => {
      if (!isOctilinear(sub(q, path[n]), 2e-3)) problems.push(`${name}: segment ${path[n]} → ${q} is not octilinear`);
    });
    return { path, stops, at };
  };

  const drawn = new Map(lines.map((l) => [l.id, offsetPath(main.get(l.id))]));

  // Where a shift has parked lines beside a station's other lines, slide their stops along the
  // track until all the stops at that station sit in one straight row.
  for (const sh of overrides.shifts ?? []) {
    const at = idOf(sh.at), here = lines.filter((l) => l.stations.includes(at));
    const stop = (l) => drawn.get(l.id).stops[l.stations.indexOf(at)];
    const rest = here.filter((l) => !sh.lines.includes(l.id)).map(stop);
    const [o, o2] = [rest[0], rest.find((q) => dist(q, rest[0]) > 1e-3)];
    if (!o2) continue;
    for (const l of here.filter((l) => sh.lines.includes(l.id))) {
      const { path, stops } = drawn.get(l.id), q = stop(l);
      const options = path.slice(1).flatMap((b, k) => {
        const a = path[k], d = sub(b, a), det = cross(d, sub(o2, o));
        if (onSegment(q, a, b) === null || Math.abs(det) < EPS) return [];
        const t = cross(sub(o, a), sub(o2, o)) / det;
        return t >= 0 && t <= 1 ? [add(a, d, t).map(r3)] : [];
      }).sort((u, v) => dist(u, q) - dist(v, q));
      if (options[0]) stops[l.stations.indexOf(at)] = options[0];
    }
  }

  const stopsAt = new Map(Object.keys(stations).map((id) => [id, []]));
  const outLines = lines.map((l) => {
    const own = measure(drawn.get(l.id), l.stations);
    l.stations.forEach((id, k) => stopsAt.get(id).push(own.stops[k]));
    const extraPaths = l.extraPaths.map((ids) => {
      const extra = measure(offsetPath(centre(ids)), ids);
      ids.forEach((id, k) => { if (!l.stations.includes(id)) stopsAt.get(id).push(extra.stops[k]); });
      return { stations: ids, ...extra };
    });
    return { ...l, ...own, extraPaths };
  });

  // Station centre = middle of its lines' stops; `marker` = those stops in order across the lanes.
  const outStations = {};
  for (const [id, s] of Object.entries(stations)) {
    const pts = stopsAt.get(id).filter((p, k, all) => all.findIndex((q) => dist(p, q) < 1e-3) === k);
    const far = pts.flatMap((p) => pts.map((q) => [p, q])).reduce((a, b) => (dist(...b) > dist(...a) ? b : a));
    const axis = sub(far[1], far[0]);
    pts.sort((p, q) => dot(sub(p, q), axis));
    const mid = [0, 1].map((c) => r3(pts.reduce((sum, p) => sum + p[c], 0) / pts.length));
    outStations[id] = { name: s.name, x: mid[0], y: mid[1], geo: [s.x, s.y], lines: s.lines, transfer: s.transfer, ...(pts.length > 1 && { marker: pts }) };
  }

  // --- checks
  const ids = Object.keys(outStations);
  let closest = { d: Infinity };
  for (const a of ids) {
    for (const b of ids) {
      if (a >= b) continue;
      const d = dist([outStations[a].x, outStations[a].y], [outStations[b].x, outStations[b].y]);
      if (d < closest.d) closest = { d, a: outStations[a].name, b: outStations[b].name };
      if (d < MIN_SPACING) problems.push(`${outStations[a].name} and ${outStations[b].name} are ${d.toFixed(2)} apart (min ${MIN_SPACING})`);
    }
  }
  const all = outLines.flatMap((l) => [l.path, ...l.extraPaths.map((e) => e.path)]).flat();
  const bounds = {
    minX: Math.min(...all.map((p) => p[0])), minY: Math.min(...all.map((p) => p[1])),
    maxX: Math.max(...all.map((p) => p[0])), maxY: Math.max(...all.map((p) => p[1])),
  };
  const segments = outLines.reduce((n, l) => n + l.path.length - 1 + l.extraPaths.reduce((m, e) => m + e.path.length - 1, 0), 0);
  const summary = `${r3(bounds.maxX - bounds.minX)} × ${r3(bounds.maxY - bounds.minY)} units, ${segments} segments, `
    + `closest stations ${closest.d.toFixed(2)} apart (${closest.a} / ${closest.b}), ${pins.size} pinned`;

  return { layout: { lane: LANE, bounds }, lines: outLines, stations: outStations, problems, summary };
}
