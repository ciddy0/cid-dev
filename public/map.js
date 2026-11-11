// Draws the schematic LA Metro map from data/metro.json as an SVG, plus the station name
// label on hover / tap / focus and a drag / pinch / wheel camera. Static for now: each line is one <path> (so it can be drawn in
// and ridden with getPointAtLength later, its terminus Ts drawn separately on top) and
// trains get their own empty layer.
const NS = "http://www.w3.org/2000/svg";
const PAD = 0.7; // schematic units of clear space around everything drawn
const COMFY = 22; // px per schematic unit at which lines and stations are easy to read and tap
const MAX_ZOOM = 64; // px per schematic unit

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
  const { lane } = map.layout;
  const size = {
    line: lane, // lanes are one stroke apart, so shared track reads as touching ribbons
    dot: lane * 0.75,
    edge: lane * 0.34,
    corner: 0.5, // bend radius, in schematic units
  };
  svg.replaceChildren();

  // The camera is bounded by what actually gets drawn (strokes, Ts and discs included), so the
  // map sits dead centre whichever way its outermost lines happen to end.
  const ink = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const cover = (x, y, r = 0) => {
    ink.minX = Math.min(ink.minX, x - r);
    ink.minY = Math.min(ink.minY, y - r);
    ink.maxX = Math.max(ink.maxX, x + r);
    ink.maxY = Math.max(ink.maxY, y + r);
  };

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
      for (const [x, y] of pts) cover(x, y, lane / 2);
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
      corners: cross.flatMap(([x, y]) =>
        [1, -1].map((k) => [x + (k * dx * lane) / 2, y + (k * dy * lane) / 2]),
      ),
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
    for (const [x, y] of t.corners) cover(x, y);
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
    cover(x, y, reach);
    stations.push({ id, ...s, x, y, lines, g, halo: reach + lane * 0.8 });
  }

  const box = {
    x: ink.minX - PAD,
    y: ink.minY - PAD,
    w: ink.maxX - ink.minX + 2 * PAD,
    h: ink.maxY - ink.minY + 2 * PAD,
  };
  // Where a zoomed-in view opens: the station the most lines meet at.
  const hub = stations.reduce((a, b) => (b.lines.length > a.lines.length ? b : a));

  const halo = el(
    "circle",
    { id: "halo", "stroke-width": lane * 0.3 },
    layers.overlay,
  );
  return { stations, halo, lane, box, hub };
}

// --- camera: the viewBox, driven by drag, pinch and wheel. A screen with room for the whole map
// at a readable size just shows it. A smaller one (a phone, mostly) shows the whole map for a
// moment, then closes in on the hub until the map fills the screen's long side, and the rest is
// a drag away.
function camera({ box, hub }) {
  const view = { x: 0, y: 0, k: 1 }; // centre in schematic units, k = px per unit
  const cam = { dragging: false, onMove() {}, onTap() {} };
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  let rect, fit, anim, touched = false;

  function apply() {
    view.k = clamp(view.k, fit, Math.max(MAX_ZOOM, fit));
    const w = rect.width / view.k,
      h = rect.height / view.k;
    // An axis the map fits along stays centred; the other stops at the map's edge.
    const hold = (c, lo, size, span) =>
      span >= size ? lo + size / 2 : clamp(c, lo + span / 2, lo + size - span / 2);
    view.x = hold(view.x, box.x, box.w, w);
    view.y = hold(view.y, box.y, box.h, h);
    svg.setAttribute(
      "viewBox",
      [view.x - w / 2, view.y - h / 2, w, h].map((v) => +v.toFixed(3)).join(" "),
    );
    svg.classList.toggle("loose", view.k > fit * 1.001);
    cam.onMove();
  }

  const whole = () => ({ x: box.x + box.w / 2, y: box.y + box.h / 2, k: fit });
  function home() {
    const cover = Math.max(rect.width / box.w, rect.height / box.h);
    const k = Math.min(cover, Math.max(fit, COMFY));
    return k > fit * 1.05 ? { x: hub.x, y: hub.y, k } : whole();
  }

  function stop() {
    cancelAnimationFrame(anim);
    clearTimeout(anim);
  }
  function glide(to, ms) {
    const from = { ...view },
      t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms),
        e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      view.k = from.k * (to.k / from.k) ** e;
      view.x = from.x + (to.x - from.x) * e;
      view.y = from.y + (to.y - from.y) * e;
      apply();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  function measure() {
    rect = svg.getBoundingClientRect();
    fit = Math.min(rect.width / box.w, rect.height / box.h);
  }
  function resize() {
    measure();
    if (!touched) {
      stop();
      Object.assign(view, home());
    }
    apply();
  }

  const pan = (dx, dy) => {
    view.x -= dx / view.k;
    view.y -= dy / view.k;
  };
  // Zoom by `factor`, keeping whatever is under the screen point (px, py) where it is.
  function zoom(px, py, factor) {
    const ox = px - rect.left - rect.width / 2,
      oy = py - rect.top - rect.height / 2;
    const k = clamp(view.k * factor, fit, Math.max(MAX_ZOOM, fit));
    view.x += ox / view.k - ox / k;
    view.y += oy / view.k - oy / k;
    view.k = k;
  }

  const fingers = new Map(); // pointer id → last clientX / clientY
  let travel = 0, // px moved since the first finger went down; a tap stays under a few
    last = 0,
    vx = 0,
    vy = 0; // px per ms, smoothed, for the fling after a drag
  const centre = () => {
    const pts = [...fingers.values()];
    return {
      x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
      y: pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
      spread: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
    };
  };

  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stop();
    touched = true;
    if (!fingers.size) travel = vx = vy = 0;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (!fingers.has(e.pointerId)) return;
    const was = centre();
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = centre();
    const dx = now.x - was.x,
      dy = now.y - was.y;
    travel += Math.hypot(dx, dy) + Math.abs(now.spread - was.spread);
    if (travel < 6) return;
    cam.dragging = true;
    svg.classList.add("dragging");
    const dt = Math.max(1, e.timeStamp - last);
    last = e.timeStamp;
    vx = vx * 0.6 + (dx / dt) * 0.4;
    vy = vy * 0.6 + (dy / dt) * 0.4;
    pan(dx, dy);
    if (was.spread && now.spread) zoom(now.x, now.y, now.spread / was.spread);
    apply();
  });
  const lift = (e) => {
    if (!fingers.delete(e.pointerId) || fingers.size) return;
    const tap = !cam.dragging && e.type === "pointerup";
    cam.dragging = false;
    svg.classList.remove("dragging");
    if (tap) return cam.onTap(e);
    if (calm || e.timeStamp - last > 80 || Math.hypot(vx, vy) < 0.1) return;
    // Fling: carry on at the speed the finger left with, slowing to a stop.
    let then = performance.now();
    const coast = (now) => {
      const dt = Math.min(now - then, 50);
      then = now;
      pan(vx * dt, vy * dt);
      vx *= 0.995 ** dt;
      vy *= 0.995 ** dt;
      apply();
      if (Math.hypot(vx, vy) > 0.02) anim = requestAnimationFrame(coast);
    };
    anim = requestAnimationFrame(coast);
  };
  svg.addEventListener("pointerup", lift);
  svg.addEventListener("pointercancel", lift);
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      stop();
      touched = true;
      // A trackpad pinch arrives as a ctrl+wheel with small deltas.
      zoom(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      apply();
    },
    { passive: false },
  );
  addEventListener("resize", resize);

  cam.sees = (s) =>
    Math.abs(s.x - view.x) * view.k <= rect.width / 2 &&
    Math.abs(s.y - view.y) * view.k <= rect.height / 2;
  // Bring a station into view, for keyboard focus landing on one that is off screen.
  cam.reveal = (s) => {
    if (cam.sees(s)) return;
    stop();
    touched = true;
    view.x = s.x;
    view.y = s.y;
    apply();
  };

  measure();
  const to = home();
  Object.assign(view, calm ? to : whole());
  apply();
  if (!calm && to.k > fit) anim = setTimeout(() => glide(to, 1400), 700);
  return cam;
}

// --- label: one floating chip row + name, shared by hover, tap and keyboard focus
function interact({ stations, halo, lane }, cam) {
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
    if (e.pointerType !== "mouse" || cam.dragging) return;
    const s = nearest(e, 12);
    if (s) show(s);
    else hide();
  });
  cam.onTap = (e) => {
    if (e.pointerType === "mouse") return;
    const s = nearest(e, 24);
    if (s) show(s);
    else hide();
  };
  // The label rides along with its station, and goes when the station leaves the screen.
  cam.onMove = () => {
    if (active && !cam.sees(active)) hide();
    else place();
  };
  // Mouse only: a finger lifting off also "leaves", right after the tap that showed the label.
  document.documentElement.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") hide();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  for (const s of stations) {
    s.g.addEventListener("focus", () => {
      cam.reveal(s);
      show(s);
    });
    s.g.addEventListener("blur", () => {
      if (active === s) hide();
    });
  }
}

try {
  const drawn = draw(await loadMap());
  interact(drawn, camera(drawn));
} catch (err) {
  console.error(err);
  status.textContent = "The map couldn't be loaded. Try refreshing.";
  status.hidden = false;
}
