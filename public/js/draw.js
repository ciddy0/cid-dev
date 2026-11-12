// Draws the map as an SVG: the ocean underneath, then each line one <path> per track (so it can be
// drawn in later), its terminus Ts drawn separately on top, then the stations. Trains get a layer of their own, and
// the halo round the picked station sits over everything.
import { el, svg } from "./dom.js";
import { bendAt, bendRadii, bendShift, bounds, toD } from "./geometry.js";
import { onLang, t } from "./lang.js";
import { round } from "./math.js";
import { lineColor, lineParts } from "./network.js";
import { termini } from "./termini.js";

const PAD = 0.7; // schematic units of clear space around everything drawn
const LAYERS = ["coast", "lines", "trains", "stations", "overlay"]; // bottom to top

// The Pacific, drawn by hand in schematic units like the lines: from Malibu, down past Santa
// Monica and the K Line to Palos Verdes, along under Long Beach and off to the south-east. The
// far corners sit well past anything the camera can show. Kept 1.5 units or so clear of the
// stations nearest the water.
const COAST = [
  [-200, 2], // Malibu
  [-21, 2],
  [-12, 11], // past Redondo Beach
  [-12, 16], // Palos Verdes
  [-7.5, 20.5],
  [5, 20.5], // under Long Beach
  [200, 215.5],
  [-200, 215.5],
];
const COAST_CORNER = 1; // how far from its corner the coast starts curving

// Every polyline to draw, as { line, part, extra, pts }: `part` is the line itself or one of
// its extra paths, `extra` 0 for the former and counting from 1 for the latter.
function layTracks(lines, corner) {
  return lines.flatMap((line) =>
    lineParts(line).map((part, extra) => {
      // A branch that rejoins its line at a bend carries on along the line until the bend is
      // over, so it merges into the curve instead of ending square on the corner.
      const pts = [...part.path];
      const [x, y] = pts.at(-1),
        [px, py] = pts.at(-2);
      const k = extra ? line.path.findIndex(([lx, ly]) => lx === x && ly === y) : -1;
      for (const to of k < 0 ? [] : [line.path[k - 1], line.path[k + 1]]) {
        const len = to ? Math.hypot(to[0] - x, to[1] - y) : 0;
        if (len && Math.abs((to[0] - x) * (y - py) - (to[1] - y) * (x - px)) < 1e-6)
          pts.push([x + ((to[0] - x) / len) * corner, y + ((to[1] - y) / len) * corner]);
      }
      return { line, part, extra, pts };
    }),
  );
}

// How far each station is pulled off its corner by the rounded bends of the tracks through it:
// station id → one shift per track.
function bendShifts(tracks) {
  const shifts = new Map();
  for (const { part, pts, radii } of tracks)
    part.stations.forEach((id, k) => {
      const [sx, sy] = part.stops[k];
      const j = pts.findIndex(([x, y]) => Math.hypot(x - sx, y - sy) < 1e-6);
      if (!shifts.has(id)) shifts.set(id, []);
      shifts.get(id).push(bendShift(pts, j, radii[j]));
    });
  return shifts;
}

function drawLines(tracks, size, layer, ink) {
  for (const track of tracks) {
    const { line, extra, pts, radii } = track;
    for (const [x, y] of pts) ink.cover(x, y, size.line / 2);
    track.path = el(
      "path",
      {
        class: "line",
        d: toD(pts, radii),
        "stroke-width": size.line,
        "data-line": line.id,
        ...(extra && { "data-extra": extra }),
      },
      layer,
    );
    track.path.style.stroke = lineColor(line);
  }
}

function drawTermini(tracks, size, layer, ink) {
  const trimmed = new Map(); // track → its points, cut back where a turning stem takes over
  for (const { line, track, at, d, corners, trim } of termini(tracks, size.line)) {
    if (trim)
      trimmed.set(track, (trimmed.get(track) ?? track.pts).with(trim.at, trim.from));
    for (const [x, y] of corners) ink.cover(x, y);
    const path = el(
      "path",
      { class: "line terminus", d, "stroke-width": size.line, "data-line": line.id },
      layer,
    );
    path.style.stroke = lineColor(line);
    (track.caps ??= []).push({ path, last: at > 0 });
  }
  for (const [track, pts] of trimmed) track.path.setAttribute("d", toD(pts, track.radii));
}

// Not counted into the camera's bounds: the ocean runs off every edge of the view.
function drawCoast(layer) {
  const radii = COAST.map((_, i) => {
    const b = bendAt(COAST, i);
    return b && COAST_CORNER / Math.tan(b.half);
  });
  el("path", { d: toD(COAST, radii) + "Z" }, layer);
}

// Returns the stations in tab order, each with its <g> and halo radius.
function drawStations(map, tracks, size, layer, ink) {
  const lane = size.line;
  const lineById = new Map(map.lines.map((l) => [l.id, l]));
  const shifts = bendShifts(tracks);
  // Tab order follows the lines, end to end.
  const order = new Set(
    map.lines.flatMap((l) => lineParts(l).flatMap((part) => part.stations)),
  );
  const stations = [];
  for (const id of order) {
    const s = map.stations[id];
    if (!s) continue;
    const lines = s.lines.map((l) => lineById.get(l)).filter(Boolean);
    const g = el(
      "g",
      {
        class: s.transfer ? "station transfer" : "station",
        tabindex: 0,
        role: "img",
      },
      layer,
    );
    onLang(() => g.setAttribute("aria-label", t("station", s.name, lines.map((l) => l.id))));
    // Every station is the same white disc with a dark edge, a bit wider than a line. One that
    // has to sit over more lanes than that grows just enough to cover them.
    const span = Math.max(
      0,
      ...(s.marker ?? []).map(([x, y]) => Math.hypot(x - s.x, y - s.y)),
    );
    const r = Math.max(size.dot, span + lane * 0.6);
    // A single-lane station on a bend follows the rounded corner, averaged over its lines.
    const own = s.marker ? [] : shifts.get(id);
    const mean = (k) => own.reduce((sum, v) => sum + v[k], 0) / (own.length || 1);
    const x = round(s.x + mean(0)),
      y = round(s.y + mean(1));
    el("circle", { cx: x, cy: y, r, "stroke-width": size.edge }, g);
    const reach = r + size.edge / 2;
    ink.cover(x, y, reach);
    stations.push({ id, ...s, x, y, lines, g, halo: reach + lane * 0.8 });
  }
  return stations;
}

// Draws `map` and returns what the rest of the page works with:
//   tracks    every polyline drawn, as { line, part, extra, pts, radii, path, caps }: `caps`
//             the Ts at its ends, each { path, last } (`last` at the end its path runs to)
//   stations  in tab order, each with its lines, its <g> and its halo radius
//   layers    the <g> for each of LAYERS
//   halo      the ring shown round the picked station
//   lane      the gap between parallel lines, which is also how thick they are stroked
//   box       { x, y, w, h } around everything drawn, padding included
//   hub       the station the most lines meet at
export function draw(map) {
  const { lane } = map.layout;
  const size = {
    line: lane, // lanes are one stroke apart, so shared track reads as touching ribbons
    dot: lane * 0.75,
    edge: lane * 0.34,
    corner: 0.5, // how far from its corner a bend starts curving, in schematic units
  };
  svg.replaceChildren();
  const layers = Object.fromEntries(LAYERS.map((id) => [id, el("g", { id }, svg)]));
  layers.trains.setAttribute("aria-hidden", "true");
  layers.coast.setAttribute("aria-hidden", "true");
  drawCoast(layers.coast);

  // The camera is bounded by what actually gets drawn (strokes, Ts and discs included), so the
  // map sits dead centre whichever way its outermost lines happen to end.
  const ink = bounds();

  const tracks = layTracks(map.lines, size.corner);
  const radii = bendRadii(tracks, size.corner, lane);
  tracks.forEach((track, t) => (track.radii = radii[t]));

  drawLines(tracks, size, layers.lines, ink);
  drawTermini(tracks, size, layers.lines, ink);
  const stations = drawStations(map, tracks, size, layers.stations, ink);
  const halo = el("circle", { id: "halo", "stroke-width": lane * 0.3 }, layers.overlay);

  return {
    tracks,
    stations,
    layers,
    halo,
    lane,
    box: ink.box(PAD),
    hub: stations.reduce((a, b) => (b.lines.length > a.lines.length ? b : a)),
  };
}
