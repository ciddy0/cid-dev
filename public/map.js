// Draws the schematic LA Metro map from data/metro.json as an SVG, plus the station name
// label on hover / tap / focus. Static for now: each line is one <path> (so it can be drawn in
// and ridden with getPointAtLength later, its terminus Ts drawn separately on top) and
// trains get their own empty layer.
const NS = "http://www.w3.org/2000/svg";
const PAD = 1.5; // schematic units around the bounds, room for strokes and markers

const svg = document.getElementById("map");
const label = document.getElementById("label");
const status = document.getElementById("status");

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}

const lineColor = (line) =>
  `var(--line-${line.id.toLowerCase()}, ${line.color})`;

// Polyline → path data with each bend rounded off. The curve starts and ends `r` from the
// corner, or halfway along a leg that is shorter than that.
function toD(pts, r = 0) {
  const n = (v) => +v.toFixed(3);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i],
      next = pts[i + 1];
    if (!next || !r) {
      d += `L${x} ${y}`;
      continue;
    }
    const [px, py] = pts[i - 1],
      [nx, ny] = next;
    const inLen = Math.hypot(x - px, y - py),
      outLen = Math.hypot(nx - x, ny - y);
    const cut = Math.min(r, inLen / 2, outLen / 2);
    d +=
      `L${n(x - ((x - px) / inLen) * cut)} ${n(y - ((y - py) / inLen) * cut)}` +
      `Q${x} ${y} ${n(x + ((nx - x) / outLen) * cut)} ${n(y + ((ny - y) / outLen) * cut)}`;
  }
  return d;
}

// How far rounding pulls the line off the corner at pts[i]: the curve's midpoint, relative to
// the corner. A station on a bend has to move by this much to stay on its line.
function bendShift(pts, i, r) {
  const prev = pts[i - 1],
    next = pts[i + 1];
  if (!prev || !next || !r) return [0, 0];
  const [x, y] = pts[i];
  const inLen = Math.hypot(x - prev[0], y - prev[1]),
    outLen = Math.hypot(next[0] - x, next[1] - y);
  const cut = Math.min(r, inLen / 2, outLen / 2) / 4;
  return [
    ((prev[0] - x) / inLen + (next[0] - x) / outLen) * cut,
    ((prev[1] - y) / inLen + (next[1] - y) / outLen) * cut,
  ];
}

// Shortest distance between two segments, each [[x, y], [x, y]]; 0 if they cross.
function segDist([p, q], [r, s]) {
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
function lineEnds(pts) {
  const end = ([x, y], [px, py]) => {
    const len = Math.hypot(x - px, y - py);
    return { x, y, dx: (x - px) / len, dy: (y - py) / len };
  };
  return pts.length < 2 ? [] : [end(pts[0], pts[1]), end(pts.at(-1), pts.at(-2))];
}

async function loadMap() {
  const res = await fetch("data/metro.json");
  if (!res.ok) throw new Error(`metro.json: ${res.status}`);
  return res.json();
}

// --- drawing: returns the stations in tab order, each with its <g> and halo radius
function draw(map) {
  const { lane, bounds: b } = map.layout;
  const size = {
    line: lane, // lanes are one stroke apart, so shared track reads as touching ribbons
    dot: lane * 0.75,
    edge: lane * 0.34,
    corner: 0.5, // bend radius, in schematic units
  };
  svg.setAttribute(
    "viewBox",
    [
      b.minX - PAD,
      b.minY - PAD,
      b.maxX - b.minX + 2 * PAD,
      b.maxY - b.minY + 2 * PAD,
    ].join(" "),
  );
  svg.replaceChildren();

  const layers = Object.fromEntries(
    ["lines", "stations", "trains", "overlay"].map((id) => [
      id,
      el("g", { id }, svg),
    ]),
  );
  layers.trains.setAttribute("aria-hidden", "true");

  const lineById = new Map(map.lines.map((l) => [l.id, l]));
  const ends = [];
  const tracks = []; // every drawn polyline, for keeping the T-bars off other lines
  const nudges = new Map(); // station id → bend shifts of the lines through it
  for (const line of map.lines) {
    for (const [i, part] of [line, ...(line.extraPaths ?? [])].entries()) {
      const pts = part.path;
      tracks.push({ line, pts });
      if (i === 0) ends.push(...lineEnds(pts).map((end) => ({ ...end, line })));
      const path = el(
        "path",
        {
          class: "line",
          d: toD(pts, size.corner),
          "stroke-width": size.line,
          "data-line": line.id,
          ...(i && { "data-extra": i }),
        },
        layers.lines,
      );
      path.style.stroke = lineColor(line);

      part.stations.forEach((id, k) => {
        const [sx, sy] = part.stops[k];
        const j = pts.findIndex(([x, y]) => Math.hypot(x - sx, y - sy) < 1e-6);
        if (!nudges.has(id)) nudges.set(id, []);
        nudges.get(id).push(bendShift(pts, j, size.corner));
      });
    }
  }

  // Each line ends in a T: a stem out of the last station and a crossbar. The stem carries
  // straight on unless that would run the T into another line or another T, in which case it
  // swings round in 45° steps to the nearest heading that is clear. Lines that end side by side
  // at one station share a T instead, each bar stopping halfway to its neighbour.
  const n = (v) => +v.toFixed(3);
  const stem = lane * 2.2,
    bar = lane * 1.4,
    skip = lane * 1.5; // the stem's first stretch sits under the station, where lines do meet
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
    return {
      segs: [[[e.x + dx * skip, e.y + dy * skip], tip], cross],
      d:
        `M${n(e.x)} ${n(e.y)}L${n(tip[0])} ${n(tip[1])}` +
        `M${n(cross[0][0])} ${n(cross[0][1])}L${n(cross[1][0])} ${n(cross[1][1])}`,
    };
  };
  const placed = [];
  for (const e of ends) {
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
      (!shared &&
        [0, 1, -1, 2, -2, 3, -3].map((turn) => tee(e, turn)).find(clear)) ||
      tee(e, 0, reach);
    placed.push(...t.segs);
    const path = el(
      "path",
      {
        class: "line terminus",
        d: t.d,
        "stroke-width": size.line,
        "data-line": e.line.id,
      },
      layers.lines,
    );
    path.style.stroke = lineColor(e.line);
  }

  // Tab order follows the lines, end to end.
  const order = new Set(
    map.lines.flatMap((l) =>
      [l, ...(l.extraPaths ?? [])].flatMap((part) => part.stations),
    ),
  );
  const stations = [];
  for (const id of order) {
    const s = map.stations[id];
    if (!s) continue;
    const lines = s.lines.map((l) => lineById.get(l)).filter(Boolean);
    const names = lines.map((l) => l.id).join(", ");
    const g = el(
      "g",
      {
        class: s.transfer ? "station transfer" : "station",
        tabindex: 0,
        role: "img",
        "aria-label": `${s.name}, ${names} ${lines.length > 1 ? "lines" : "line"}`,
      },
      layers.stations,
    );
    // Every station is the same white disc with a dark edge, a bit wider than a line. One that
    // has to sit over more lanes than that grows just enough to cover them.
    const span = Math.max(
      0,
      ...(s.marker ?? []).map(([x, y]) => Math.hypot(x - s.x, y - s.y)),
    );
    const r = Math.max(size.dot, span + lane * 0.6);
    // A single-lane station on a bend follows the rounded corner, averaged over its lines.
    const shifts = s.marker ? [] : nudges.get(id);
    const mean = (k) =>
      shifts.reduce((sum, v) => sum + v[k], 0) / (shifts.length || 1);
    const x = +(s.x + mean(0)).toFixed(3),
      y = +(s.y + mean(1)).toFixed(3);
    el("circle", { cx: x, cy: y, r, "stroke-width": size.edge }, g);
    const reach = r + size.edge / 2;
    stations.push({ id, ...s, x, y, lines, g, halo: reach + lane * 0.8 });
  }

  const halo = el(
    "circle",
    { id: "halo", "stroke-width": lane * 0.3 },
    layers.overlay,
  );
  return { stations, halo, lane };
}

// --- label: one floating chip row + name, shared by hover, tap and keyboard focus
function interact({ stations, halo, lane }) {
  let active = null;

  const toScreen = (s) => {
    const m = svg.getScreenCTM();
    return { x: m.a * s.x + m.e, y: m.d * s.y + m.f, scale: m.a };
  };

  function place() {
    if (!active) return;
    const p = toScreen(active);
    const gap = active.halo * p.scale + 8;
    const w = label.offsetWidth,
      h = label.offsetHeight,
      edge = 8;
    const x = Math.max(edge, Math.min(p.x - w / 2, innerWidth - w - edge));
    let y = p.y - gap - h;
    if (y < edge) y = p.y + gap; // no room above: drop below the station
    label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function show(s) {
    if (s === active) return;
    active = s;
    const chips = document.createElement("span");
    chips.className = "chips";
    for (const line of s.lines) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = line.id;
      chip.style.background = lineColor(line);
      chip.style.color = line.textColor;
      chips.append(chip);
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = s.name;
    label.replaceChildren(chips, name);
    halo.setAttribute("cx", s.x);
    halo.setAttribute("cy", s.y);
    halo.setAttribute("r", s.halo);
    place();
    label.classList.add("on");
    halo.classList.add("on");
    svg.classList.add("hot");
  }

  function hide() {
    active = null;
    label.classList.remove("on");
    halo.classList.remove("on");
    svg.classList.remove("hot");
  }

  // Stations are tiny, so pick the nearest one within a finger-sized radius instead of
  // relying on the marker itself being hit.
  function nearest(e, reachPx) {
    const m = svg.getScreenCTM();
    const x = (e.clientX - m.e) / m.a,
      y = (e.clientY - m.f) / m.d;
    const reach = Math.max(reachPx / m.a, 0.45);
    let best = null,
      bestD = Infinity;
    for (const s of stations) {
      const d = Math.hypot(s.x - x, s.y - y) - (s.halo - lane);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return bestD <= reach ? best : null;
  }

  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const s = nearest(e, 12);
    if (s) show(s);
    else hide();
  });
  addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    const s = nearest(e, 24);
    if (s) show(s);
    else hide();
  });
  document.documentElement.addEventListener("pointerleave", hide);
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  for (const s of stations) {
    s.g.addEventListener("focus", () => show(s));
    s.g.addEventListener("blur", () => {
      if (active === s) hide();
    });
  }
  addEventListener("resize", place);
}

try {
  interact(draw(await loadMap()));
} catch (err) {
  console.error(err);
  status.textContent = "The map couldn't be loaded. Try refreshing.";
  status.hidden = false;
}
