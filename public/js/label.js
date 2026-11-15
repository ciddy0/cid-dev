// The station label: one floating chip row + name, shared by hover, tap and keyboard focus,
// with a halo round the station it names.
import { svg, toMap, toScreen } from "./dom.js";
import { t } from "./lang.js";
import { clamp } from "./math.js";
import { lineColor, lineInk } from "./network.js";

const HOVER_REACH = 12;
const TAP_REACH = 24;
const REACH_MIN = 0.45;
const EDGE = 8;

const label = document.getElementById("label");

export function stationLabel({ stations, halo, lane }, cam) {
  let active = null;

  function place() {
    if (!active) return;
    const p = toScreen(active);
    const gap = active.halo * p.scale + EDGE;
    const w = label.offsetWidth,
      h = label.offsetHeight;
    const x = clamp(p.x - w / 2, EDGE, innerWidth - w - EDGE);
    let y = p.y - gap - h;
    if (y < EDGE) y = p.y + gap; // no room above: drop below the station
    label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // A screen reader reads the label out as it changes: the station in words (`said`), not the
  // chips' letters. `spoken` is off for a station with focus, which has just been read itself.
  function show(s, spoken = true) {
    if (s === active) return;
    active = s;
    const chips = document.createElement("span");
    chips.className = "chips";
    chips.setAttribute("aria-hidden", "true");
    for (const line of s.lines) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = line.id;
      chip.style.background = lineColor(line);
      chip.style.color = lineInk(line);
      chips.append(chip);
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = s.name;
    name.setAttribute("aria-hidden", "true");
    const said = document.createElement("span");
    said.className = "sr";
    if (spoken)
      said.textContent = t(
        "station",
        s.name,
        s.lines.map((line) => line.id),
      );
    label.replaceChildren(chips, name, said);
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
    const { x, y, scale } = toMap(e);
    const reach = Math.max(reachPx / scale, REACH_MIN);
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
  const pick = (e, reachPx) => {
    const s = nearest(e, reachPx);
    if (s) show(s);
    else hide();
  };

  // Only over the map itself: under the back arrow, a station keeps quiet.
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || cam.dragging || !cam.roam) return;
    if (svg.contains(e.target)) pick(e, HOVER_REACH);
    else hide();
  });
  cam.onTap = (e) => {
    if (e.pointerType !== "mouse") pick(e, TAP_REACH);
  };
  cam.onMove = () => {
    if (active && !(cam.roam && cam.sees(active))) hide();
    else place();
  };
  document.documentElement.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") hide();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  for (const s of stations) {
    s.g.addEventListener("focus", () => {
      cam.reveal(s);
      show(s, false);
    });
    s.g.addEventListener("blur", () => {
      if (active === s) hide();
    });
  }
}
