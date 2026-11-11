// Draws the schematic LA Metro map from data/metro.json as an SVG, plus the station name
// label on hover / tap / focus. Static for now: each line is one <path> (so it can be drawn in
// and ridden with getPointAtLength later) and trains get their own empty layer.
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

const lineColor = (line) => `var(--line-${line.id.toLowerCase()}, ${line.color})`;

// Polyline → path data with each bend rounded off. The curve starts and ends `r` from the
// corner, or halfway along a leg that is shorter than that.
function toD(pts, r = 0) {
  const n = (v) => +v.toFixed(3);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i], next = pts[i + 1];
    if (!next || !r) { d += `L${x} ${y}`; continue; }
    const [px, py] = pts[i - 1], [nx, ny] = next;
    const inLen = Math.hypot(x - px, y - py), outLen = Math.hypot(nx - x, ny - y);
    const cut = Math.min(r, inLen / 2, outLen / 2);
    d += `L${n(x - ((x - px) / inLen) * cut)} ${n(y - ((y - py) / inLen) * cut)}`
      + `Q${x} ${y} ${n(x + ((nx - x) / outLen) * cut)} ${n(y + ((ny - y) / outLen) * cut)}`;
  }
  return d;
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
    dot: lane, edge: lane * 0.3,
    corner: 0.5, // bend radius, in schematic units
  };
  svg.setAttribute("viewBox",
    [b.minX - PAD, b.minY - PAD, b.maxX - b.minX + 2 * PAD, b.maxY - b.minY + 2 * PAD].join(" "));
  svg.replaceChildren();

  const layers = Object.fromEntries(["lines", "stations", "trains", "overlay"]
    .map((id) => [id, el("g", { id }, svg)]));
  layers.trains.setAttribute("aria-hidden", "true");

  const lineById = new Map(map.lines.map((l) => [l.id, l]));
  for (const line of map.lines) {
    for (const [i, part] of [line, ...(line.extraPaths ?? [])].entries()) {
      const path = el("path", {
        class: "line", d: toD(part.path, size.corner), "stroke-width": size.line,
        "data-line": line.id, ...(i && { "data-extra": i }),
      }, layers.lines);
      path.style.stroke = lineColor(line);
    }
  }

  // Tab order follows the lines, end to end.
  const order = new Set(map.lines.flatMap((l) =>
    [l, ...(l.extraPaths ?? [])].flatMap((part) => part.stations)));
  const stations = [];
  for (const id of order) {
    const s = map.stations[id];
    if (!s) continue;
    const lines = s.lines.map((l) => lineById.get(l)).filter(Boolean);
    const names = lines.map((l) => l.id).join(", ");
    const g = el("g", {
      class: s.transfer ? "station transfer" : "station", tabindex: 0, role: "img",
      "aria-label": `${s.name}, ${names} ${lines.length > 1 ? "lines" : "line"}`,
    }, layers.stations);
    // Every station is the same white disc with a dark edge, twice as wide as a line.
    // One that has to sit over more lanes than that grows just enough to cover them.
    const span = Math.max(0, ...(s.marker ?? []).map(([x, y]) => Math.hypot(x - s.x, y - s.y)));
    const r = Math.max(size.dot, span + lane * 0.75);
    el("circle", { cx: s.x, cy: s.y, r, "stroke-width": size.edge }, g);
    const reach = r + size.edge / 2;
    stations.push({ id, ...s, lines, g, halo: reach + lane * 0.8 });
  }

  const halo = el("circle", { id: "halo", "stroke-width": lane * 0.3 }, layers.overlay);
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
    const w = label.offsetWidth, h = label.offsetHeight, edge = 8;
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
    const x = (e.clientX - m.e) / m.a, y = (e.clientY - m.f) / m.d;
    const reach = Math.max(reachPx / m.a, 0.45);
    let best = null, bestD = Infinity;
    for (const s of stations) {
      const d = Math.hypot(s.x - x, s.y - y) - (s.halo - lane);
      if (d < bestD) { best = s; bestD = d; }
    }
    return bestD <= reach ? best : null;
  }

  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const s = nearest(e, 12);
    if (s) show(s); else hide();
  });
  addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    const s = nearest(e, 24);
    if (s) show(s); else hide();
  });
  document.documentElement.addEventListener("pointerleave", hide);
  addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  for (const s of stations) {
    s.g.addEventListener("focus", () => show(s));
    s.g.addEventListener("blur", () => { if (active === s) hide(); });
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
